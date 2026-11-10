"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createCompartment = createCompartment;
exports.renameCompartment = renameCompartment;
exports.removeCompartment = removeCompartment;
exports.reorderCompartments = reorderCompartments;
exports.applyInventoryTemplate = applyInventoryTemplate;
exports.createInventoryItem = createInventoryItem;
exports.updateInventoryItem = updateInventoryItem;
exports.deleteInventoryItem = deleteInventoryItem;
exports.getVehicleInventory = getVehicleInventory;
const prisma_1 = require("../../config/prisma");
const transaction_1 = require("../../utils/transaction");
const operations_schemas_1 = require("../operations/operations.schemas");
const inventory_templates_1 = require("./inventory-templates");
async function activeVehicle(tx, id) {
    const row = await tx.vehicle.findFirst({ where: { id, asset: { deletedAt: null } } });
    if (!row)
        throw new operations_schemas_1.OperationError(404, "Movil no encontrado");
    return row;
}
async function audit(tx, actorUserId, action, entityId, metadata) {
    await tx.auditLog.create({ data: { actorUserId: actorUserId || null, action, entityType: "VehicleInventory", entityId, metadata: JSON.parse(JSON.stringify(metadata)) } });
}
async function createCompartment(vehicleId, data, actorUserId) {
    return (0, transaction_1.serializable)(async (tx) => {
        await activeVehicle(tx, vehicleId);
        if (await tx.vehicleCompartment.findFirst({ where: { vehicleId, name: { equals: data.name, mode: "insensitive" } } }))
            throw new operations_schemas_1.OperationError(409, "Ya existe una baulera con ese nombre");
        if (await tx.vehicleCompartment.count({ where: { vehicleId } }) >= 100)
            throw new operations_schemas_1.OperationError(400, "Limite de 100 compartimentos por movil");
        const last = await tx.vehicleCompartment.aggregate({ where: { vehicleId }, _max: { sortOrder: true } });
        const row = await tx.vehicleCompartment.create({ data: { ...data, vehicleId, sortOrder: data.sortOrder ?? (last._max.sortOrder ?? -1) + 1 } });
        await audit(tx, actorUserId, "VEHICLE_COMPARTMENT_CREATED", row.id, { vehicleId, after: row });
        return row;
    });
}
async function renameCompartment(id, name, revision, actorUserId) {
    return (0, transaction_1.serializable)(async (tx) => {
        const before = await tx.vehicleCompartment.findUnique({ where: { id } });
        if (!before)
            throw new operations_schemas_1.OperationError(404, "Baulera no encontrada");
        await activeVehicle(tx, before.vehicleId);
        if (await tx.vehicleCompartment.findFirst({ where: { vehicleId: before.vehicleId, id: { not: id }, name: { equals: name, mode: "insensitive" } } }))
            throw new operations_schemas_1.OperationError(409, "Nombre de baulera repetido");
        if (!(await tx.vehicleCompartment.updateMany({ where: { id, revision }, data: { name, revision: { increment: 1 } } })).count)
            throw new operations_schemas_1.OperationError(409, "La baulera cambio; recargue antes de editar");
        await audit(tx, actorUserId, "VEHICLE_COMPARTMENT_RENAMED", id, { before, name });
        return tx.vehicleCompartment.findUniqueOrThrow({ where: { id } });
    });
}
async function removeCompartment(id, revision, actorUserId) {
    return (0, transaction_1.serializable)(async (tx) => {
        const before = await tx.vehicleCompartment.findUnique({ where: { id }, include: { _count: { select: { items: true } } } });
        if (!before)
            throw new operations_schemas_1.OperationError(404, "Baulera no encontrada");
        await activeVehicle(tx, before.vehicleId);
        if (before._count.items)
            throw new operations_schemas_1.OperationError(409, "Mueva sus materiales antes de eliminar la baulera; no se borra inventario en cascada");
        if (!(await tx.vehicleCompartment.deleteMany({ where: { id, revision, items: { none: {} } } })).count)
            throw new operations_schemas_1.OperationError(409, "La baulera cambio; recargue antes de eliminar");
        await audit(tx, actorUserId, "VEHICLE_COMPARTMENT_DELETED", id, { before });
        return { message: "Baulera vacia eliminada" };
    });
}
async function reorderCompartments(vehicleId, input, actorUserId) {
    return (0, transaction_1.serializable)(async (tx) => {
        await activeVehicle(tx, vehicleId);
        const before = await tx.vehicleCompartment.findMany({ where: { vehicleId }, select: { id: true, sortOrder: true, revision: true } });
        if (before.length !== input.compartments.length || before.some((c) => !input.compartments.some((v) => v.id === c.id && v.revision === c.revision)))
            throw new operations_schemas_1.OperationError(409, "El inventario cambio; envie todas las bauleras vigentes");
        for (const [sortOrder, c] of input.compartments.entries()) {
            if (!(await tx.vehicleCompartment.updateMany({ where: { id: c.id, vehicleId, revision: c.revision }, data: { sortOrder, revision: { increment: 1 } } })).count)
                throw new operations_schemas_1.OperationError(409, "La baulera cambio");
        }
        await audit(tx, actorUserId, "VEHICLE_COMPARTMENTS_REORDERED", vehicleId, { before, after: input.compartments });
        return { message: "Orden guardado" };
    });
}
async function applyInventoryTemplate(vehicleId, template, actorUserId) {
    return (0, transaction_1.serializable)(async (tx) => {
        const vehicle = await activeVehicle(tx, vehicleId);
        if (await tx.vehicleCompartment.count({ where: { vehicleId } }))
            throw new operations_schemas_1.OperationError(409, "La plantilla solo se aplica a moviles sin bauleras; no reemplaza ni duplica inventario existente");
        for (const [sortOrder, section] of inventory_templates_1.inventoryTemplates[template].compartments.entries()) {
            await tx.vehicleCompartment.create({ data: { vehicleId, name: section.name, sortOrder, items: { create: section.items.map((name) => ({ name, expectedQuantity: 1, state: "REVIEW", notes: "Plantilla pendiente de inventario fisico y aprobacion de cantidades" })) } } });
        }
        await tx.asset.update({ where: { id: vehicle.assetId }, data: { status: "MAINTENANCE" } });
        await audit(tx, actorUserId, "VEHICLE_TEMPLATE_APPLIED", vehicleId, { template });
        return { message: "Plantilla cargada; requiere inventario y control fisico antes de habilitar el movil" };
    });
}
async function createInventoryItem(compartmentId, data, actorUserId) {
    return (0, transaction_1.serializable)(async (tx) => {
        const section = await tx.vehicleCompartment.findUnique({ where: { id: compartmentId } });
        if (!section)
            throw new operations_schemas_1.OperationError(404, "Baulera no encontrada");
        await activeVehicle(tx, section.vehicleId);
        if (await tx.vehicleInventoryItem.findFirst({ where: { compartmentId, name: { equals: data.name, mode: "insensitive" } } }))
            throw new operations_schemas_1.OperationError(409, "Material repetido en la baulera");
        if (data.labelCode && await tx.vehicleInventoryItem.findUnique({ where: { labelCode: data.labelCode } }))
            throw new operations_schemas_1.OperationError(409, "La etiqueta ya identifica otro material");
        const row = await tx.vehicleInventoryItem.create({ data: { ...data, compartmentId, expiresOn: data.expiresOn ? new Date(data.expiresOn) : null } });
        await audit(tx, actorUserId, "VEHICLE_INVENTORY_ITEM_CREATED", row.id, { vehicleId: section.vehicleId, after: row });
        return row;
    });
}
async function updateInventoryItem(itemId, data, actorUserId) {
    return (0, transaction_1.serializable)(async (tx) => {
        const before = await tx.vehicleInventoryItem.findUnique({ where: { id: itemId }, include: { compartment: true } });
        if (!before)
            throw new operations_schemas_1.OperationError(404, "Material no encontrado");
        await activeVehicle(tx, before.compartment.vehicleId);
        const target = await tx.vehicleCompartment.findFirst({ where: { id: data.compartmentId ?? before.compartmentId, vehicleId: before.compartment.vehicleId } });
        if (!target)
            throw new operations_schemas_1.OperationError(400, "La baulera debe pertenecer al mismo movil");
        if (await tx.vehicleInventoryItem.findFirst({ where: { id: { not: itemId }, compartmentId: target.id, name: { equals: data.name ?? before.name, mode: "insensitive" } } }))
            throw new operations_schemas_1.OperationError(409, "Material repetido en la baulera destino");
        if (data.labelCode && await tx.vehicleInventoryItem.findFirst({ where: { labelCode: data.labelCode, id: { not: itemId } } }))
            throw new operations_schemas_1.OperationError(409, "Etiqueta ya utilizada");
        const { revision, expiresOn, ...fields } = data;
        if (!(await tx.vehicleInventoryItem.updateMany({ where: { id: itemId, revision }, data: { ...fields, ...(expiresOn !== undefined ? { expiresOn: expiresOn ? new Date(expiresOn) : null } : {}), revision: { increment: 1 } } })).count)
            throw new operations_schemas_1.OperationError(409, "El material cambio; recargue antes de editar");
        const after = await tx.vehicleInventoryItem.findUniqueOrThrow({ where: { id: itemId } });
        await audit(tx, actorUserId, "VEHICLE_INVENTORY_ITEM_UPDATED", itemId, { before, after });
        return after;
    });
}
async function deleteInventoryItem(itemId, actorUserId, revision) {
    return (0, transaction_1.serializable)(async (tx) => {
        const before = await tx.vehicleInventoryItem.findUnique({ where: { id: itemId }, include: { compartment: true, _count: { select: { inspectionItems: true } } } });
        if (!before)
            throw new operations_schemas_1.OperationError(404, "Material no encontrado");
        await activeVehicle(tx, before.compartment.vehicleId);
        if (before._count.inspectionItems)
            throw new operations_schemas_1.OperationError(409, "No se elimina material con controles historicos; marquelo fuera de servicio");
        if (!(await tx.vehicleInventoryItem.deleteMany({ where: { id: itemId, revision } })).count)
            throw new operations_schemas_1.OperationError(409, "El material cambio");
        await audit(tx, actorUserId, "VEHICLE_INVENTORY_ITEM_DELETED", itemId, { before });
        return { message: "Material eliminado" };
    });
}
async function getVehicleInventory(vehicleId) {
    const row = await prisma_1.prisma.vehicle.findFirst({ where: { id: vehicleId, asset: { deletedAt: null } }, include: { asset: true, compartments: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }], include: { items: { orderBy: { name: "asc" }, include: { inspectionItems: { take: 1, orderBy: [{ inspection: { inspectionDate: "desc" } }, { inspection: { inspectionTime: "desc" } }, { createdAt: "desc" }], select: { expectedQuantity: true, observedQuantity: true, result: true, observations: true } } } } } } } });
    if (!row)
        throw new operations_schemas_1.OperationError(404, "Movil no encontrado");
    return row;
}
