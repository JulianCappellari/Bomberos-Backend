import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma";
import { serializable } from "../../utils/transaction";
import { OperationError } from "../operations/operations.schemas";
import { createCompartmentSchema, createInventoryItemSchema, updateInventoryItemSchema, compartmentOrderSchema } from "./equipment.schemas";
import { inventoryTemplates } from "./inventory-templates";

async function activeVehicle(tx: Prisma.TransactionClient, id: string) {
  const row = await tx.vehicle.findFirst({ where: { id, asset: { deletedAt: null } } });
  if (!row) throw new OperationError(404, "Movil no encontrado");
  return row;
}
async function audit(tx: Prisma.TransactionClient, actorUserId: string | undefined, action: string, entityId: string, metadata: object) {
  await tx.auditLog.create({ data: { actorUserId: actorUserId || null, action, entityType: "VehicleInventory", entityId, metadata: JSON.parse(JSON.stringify(metadata)) } });
}
export async function createCompartment(vehicleId: string, data: z.infer<typeof createCompartmentSchema>, actorUserId?: string) {
  return serializable(async (tx) => {
    await activeVehicle(tx, vehicleId);
    if (await tx.vehicleCompartment.findFirst({ where: { vehicleId, name: { equals: data.name, mode: "insensitive" } } })) throw new OperationError(409, "Ya existe una baulera con ese nombre");
    if (await tx.vehicleCompartment.count({ where: { vehicleId } }) >= 100) throw new OperationError(400, "Limite de 100 compartimentos por movil");
    const last = await tx.vehicleCompartment.aggregate({ where: { vehicleId }, _max: { sortOrder: true } });
    const row = await tx.vehicleCompartment.create({ data: { ...data, vehicleId, sortOrder: data.sortOrder ?? (last._max.sortOrder ?? -1) + 1 } });
    await audit(tx, actorUserId, "VEHICLE_COMPARTMENT_CREATED", row.id, { vehicleId, after: row }); return row;
  });
}
export async function renameCompartment(id: string, name: string, revision: number, actorUserId: string) {
  return serializable(async (tx) => {
    const before = await tx.vehicleCompartment.findUnique({ where: { id } });
    if (!before) throw new OperationError(404, "Baulera no encontrada");
    await activeVehicle(tx, before.vehicleId);
    if (await tx.vehicleCompartment.findFirst({ where: { vehicleId: before.vehicleId, id: { not: id }, name: { equals: name, mode: "insensitive" } } })) throw new OperationError(409, "Nombre de baulera repetido");
    if (!(await tx.vehicleCompartment.updateMany({ where: { id, revision }, data: { name, revision: { increment: 1 } } })).count) throw new OperationError(409, "La baulera cambio; recargue antes de editar");
    await audit(tx, actorUserId, "VEHICLE_COMPARTMENT_RENAMED", id, { before, name });
    return tx.vehicleCompartment.findUniqueOrThrow({ where: { id } });
  });
}
export async function removeCompartment(id: string, revision: number, actorUserId: string) {
  return serializable(async (tx) => {
    const before = await tx.vehicleCompartment.findUnique({ where: { id }, include: { _count: { select: { items: true } } } });
    if (!before) throw new OperationError(404, "Baulera no encontrada");
    await activeVehicle(tx, before.vehicleId);
    if (before._count.items) throw new OperationError(409, "Mueva sus materiales antes de eliminar la baulera; no se borra inventario en cascada");
    if (!(await tx.vehicleCompartment.deleteMany({ where: { id, revision, items: { none: {} } } })).count) throw new OperationError(409, "La baulera cambio; recargue antes de eliminar");
    await audit(tx, actorUserId, "VEHICLE_COMPARTMENT_DELETED", id, { before }); return { message: "Baulera vacia eliminada" };
  });
}
export async function reorderCompartments(vehicleId: string, input: z.infer<typeof compartmentOrderSchema>, actorUserId: string) {
  return serializable(async (tx) => {
    await activeVehicle(tx, vehicleId);
    const before = await tx.vehicleCompartment.findMany({ where: { vehicleId }, select: { id: true, sortOrder: true, revision: true } });
    if (before.length !== input.compartments.length || before.some((c) => !input.compartments.some((v) => v.id === c.id && v.revision === c.revision))) throw new OperationError(409, "El inventario cambio; envie todas las bauleras vigentes");
    for (const [sortOrder, c] of input.compartments.entries()) {
      if (!(await tx.vehicleCompartment.updateMany({ where: { id: c.id, vehicleId, revision: c.revision }, data: { sortOrder, revision: { increment: 1 } } })).count) throw new OperationError(409, "La baulera cambio");
    }
    await audit(tx, actorUserId, "VEHICLE_COMPARTMENTS_REORDERED", vehicleId, { before, after: input.compartments }); return { message: "Orden guardado" };
  });
}
export async function applyInventoryTemplate(vehicleId: string, template: keyof typeof inventoryTemplates, actorUserId: string) {
  return serializable(async (tx) => {
    const vehicle = await activeVehicle(tx, vehicleId);
    if (await tx.vehicleCompartment.count({ where: { vehicleId } })) throw new OperationError(409, "La plantilla solo se aplica a moviles sin bauleras; no reemplaza ni duplica inventario existente");
    for (const [sortOrder, section] of inventoryTemplates[template].compartments.entries()) {
      await tx.vehicleCompartment.create({ data: { vehicleId, name: section.name, sortOrder, items: { create: section.items.map((name) => ({ name, expectedQuantity: 1, state: "REVIEW", notes: "Plantilla pendiente de inventario fisico y aprobacion de cantidades" })) } } });
    }
    await tx.asset.update({ where: { id: vehicle.assetId }, data: { status: "MAINTENANCE" } });
    await audit(tx, actorUserId, "VEHICLE_TEMPLATE_APPLIED", vehicleId, { template }); return { message: "Plantilla cargada; requiere inventario y control fisico antes de habilitar el movil" };
  });
}
export async function createInventoryItem(compartmentId: string, data: z.infer<typeof createInventoryItemSchema>, actorUserId?: string) {
  return serializable(async (tx) => {
    const section = await tx.vehicleCompartment.findUnique({ where: { id: compartmentId } });
    if (!section) throw new OperationError(404, "Baulera no encontrada");
    await activeVehicle(tx, section.vehicleId);
    if (await tx.vehicleInventoryItem.findFirst({ where: { compartmentId, name: { equals: data.name, mode: "insensitive" } } })) throw new OperationError(409, "Material repetido en la baulera");
    if (data.labelCode && await tx.vehicleInventoryItem.findUnique({ where: { labelCode: data.labelCode } })) throw new OperationError(409, "La etiqueta ya identifica otro material");
    const row = await tx.vehicleInventoryItem.create({ data: { ...data, compartmentId, expiresOn: data.expiresOn ? new Date(data.expiresOn) : null } });
    await audit(tx, actorUserId, "VEHICLE_INVENTORY_ITEM_CREATED", row.id, { vehicleId: section.vehicleId, after: row }); return row;
  });
}
export async function updateInventoryItem(itemId: string, data: z.infer<typeof updateInventoryItemSchema>, actorUserId?: string) {
  return serializable(async (tx) => {
    const before = await tx.vehicleInventoryItem.findUnique({ where: { id: itemId }, include: { compartment: true } });
    if (!before) throw new OperationError(404, "Material no encontrado");
    await activeVehicle(tx, before.compartment.vehicleId);
    const target = await tx.vehicleCompartment.findFirst({ where: { id: data.compartmentId ?? before.compartmentId, vehicleId: before.compartment.vehicleId } });
    if (!target) throw new OperationError(400, "La baulera debe pertenecer al mismo movil");
    if (await tx.vehicleInventoryItem.findFirst({ where: { id: { not: itemId }, compartmentId: target.id, name: { equals: data.name ?? before.name, mode: "insensitive" } } })) throw new OperationError(409, "Material repetido en la baulera destino");
    if (data.labelCode && await tx.vehicleInventoryItem.findFirst({ where: { labelCode: data.labelCode, id: { not: itemId } } })) throw new OperationError(409, "Etiqueta ya utilizada");
    const { revision, expiresOn, ...fields } = data;
    if (!(await tx.vehicleInventoryItem.updateMany({ where: { id: itemId, revision }, data: { ...fields, ...(expiresOn !== undefined ? { expiresOn: expiresOn ? new Date(expiresOn) : null } : {}), revision: { increment: 1 } } })).count) throw new OperationError(409, "El material cambio; recargue antes de editar");
    const after = await tx.vehicleInventoryItem.findUniqueOrThrow({ where: { id: itemId } });
    await audit(tx, actorUserId, "VEHICLE_INVENTORY_ITEM_UPDATED", itemId, { before, after }); return after;
  });
}
export async function deleteInventoryItem(itemId: string, actorUserId?: string, revision?: number) {
  return serializable(async (tx) => {
    const before = await tx.vehicleInventoryItem.findUnique({ where: { id: itemId }, include: { compartment: true, _count: { select: { inspectionItems: true } } } });
    if (!before) throw new OperationError(404, "Material no encontrado");
    await activeVehicle(tx, before.compartment.vehicleId);
    if (before._count.inspectionItems) throw new OperationError(409, "No se elimina material con controles historicos; marquelo fuera de servicio");
    if (!(await tx.vehicleInventoryItem.deleteMany({ where: { id: itemId, revision } })).count) throw new OperationError(409, "El material cambio");
    await audit(tx, actorUserId, "VEHICLE_INVENTORY_ITEM_DELETED", itemId, { before }); return { message: "Material eliminado" };
  });
}
export async function getVehicleInventory(vehicleId: string) {
  const row = await prisma.vehicle.findFirst({ where: { id: vehicleId, asset: { deletedAt: null } }, include: { asset: true, compartments: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }], include: { items: { orderBy: { name: "asc" }, include: { inspectionItems: { take: 1, orderBy: [{ inspection: { inspectionDate: "desc" } }, { inspection: { inspectionTime: "desc" } }, { createdAt: "desc" }], select: { expectedQuantity: true, observedQuantity: true, result: true, observations: true } } } } } } } });
  if (!row) throw new OperationError(404, "Movil no encontrado");
  return row;
}
