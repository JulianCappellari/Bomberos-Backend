"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listPersonalEquipment = listPersonalEquipment;
exports.equipmentHistory = equipmentHistory;
exports.createPersonalEquipment = createPersonalEquipment;
exports.updatePersonalEquipment = updatePersonalEquipment;
exports.checkPersonalEquipment = checkPersonalEquipment;
exports.issuePersonalEquipment = issuePersonalEquipment;
exports.returnPersonalEquipment = returnPersonalEquipment;
exports.archivePersonalEquipment = archivePersonalEquipment;
const firefighter_ranks_1 = require("../../utils/firefighter-ranks");
const notifications_service_1 = require("../members/notifications.service");
const prisma_1 = require("../../config/prisma");
const transaction_1 = require("../../utils/transaction");
const public_user_1 = require("../../utils/public-user");
const operations_schemas_1 = require("../operations/operations.schemas");
const pageSize = 30;
const blocking = { blocksOperation: true, status: { in: ["OPEN", "IN_PROGRESS"] } };
const include = {
    asset: { select: { id: true, name: true, status: true, deletedAt: true, maintenanceJobs: { where: blocking, select: { id: true } } } },
    issues: { where: { returnedAt: null }, take: 1, include: { user: { select: public_user_1.PUBLIC_USER_SELECT }, issuedBy: { select: public_user_1.PUBLIC_USER_SELECT } } },
    checks: { take: 1, orderBy: [{ checkedAt: "desc" }, { id: "desc" }], include: { checkedBy: { select: public_user_1.PUBLIC_USER_SELECT } } },
};
async function load(tx, id) {
    const item = await tx.personalEquipment.findUnique({ where: { id }, include });
    if (!item || item.asset.deletedAt)
        throw new operations_schemas_1.OperationError(404, "Elemento no encontrado");
    return item;
}
async function claim(tx, id, revision) {
    const result = await tx.personalEquipment.updateMany({ where: { id, revision, archivedAt: null }, data: { revision: { increment: 1 } } });
    if (!result.count)
        throw new operations_schemas_1.OperationError(409, "El elemento cambio o fue dado de baja. Actualice la lista.");
}
async function audit(tx, actorUserId, action, entityId, metadata = {}) {
    await tx.auditLog.create({ data: { actorUserId, action, entityType: "PersonalEquipment", entityId, metadata } });
}
function publicItem(row, actor) {
    const { issues, asset, ...item } = row;
    const current = issues[0];
    return { ...item, asset: { id: asset.id, name: asset.name, status: asset.status }, assigned: !!current,
        available: !item.archivedAt && !current && asset.status === "OPERATIONAL" && !asset.maintenanceJobs.length,
        currentIssue: current && (["ADMIN", "OPERATOR"].includes(actor.role) || current.userId === actor.userId) ? current : null,
        blockingMaintenance: asset.maintenanceJobs.length > 0,
    };
}
async function listPersonalEquipment(filters, actor) {
    const where = {
        archivedAt: filters.view === "archived" ? { not: null } : null,
        asset: { deletedAt: null }, ...(filters.category ? { category: filters.category } : {}),
        ...(filters.q ? { OR: [{ code: { contains: filters.q, mode: "insensitive" } }, { asset: { name: { contains: filters.q, mode: "insensitive" } } }] } : {}),
    };
    if (filters.view === "mine")
        where.issues = { some: { returnedAt: null, userId: actor.userId } };
    if (filters.view === "assigned")
        where.issues = { some: { returnedAt: null } };
    if (filters.view === "review")
        where.asset = { deletedAt: null, status: { not: "OPERATIONAL" } };
    if (filters.view === "available") {
        where.issues = { none: { returnedAt: null } };
        where.asset = { deletedAt: null, status: "OPERATIONAL", maintenanceJobs: { none: blocking } };
    }
    if (!["ADMIN", "OPERATOR"].includes(actor.role))
        where.AND = [{ issues: { some: { returnedAt: null, userId: actor.userId } } }];
    const [rows, total] = await prisma_1.prisma.$transaction([
        prisma_1.prisma.personalEquipment.findMany({ where, include, orderBy: [{ code: "asc" }], skip: (filters.page - 1) * pageSize, take: pageSize }),
        prisma_1.prisma.personalEquipment.count({ where }),
    ], { isolationLevel: "RepeatableRead" });
    return { items: rows.map((row) => publicItem(row, actor)), total, page: filters.page, pageSize };
}
async function equipmentHistory(id, page, actor) {
    const exists = await prisma_1.prisma.personalEquipment.findFirst({ where: { id, asset: { deletedAt: null } }, select: { id: true } });
    if (!exists)
        throw new operations_schemas_1.OperationError(404, "Elemento no encontrado");
    const where = { equipmentId: id, ...(!["ADMIN", "OPERATOR"].includes(actor.role) ? { userId: actor.userId } : {}) };
    const [issues, total] = await prisma_1.prisma.$transaction([
        prisma_1.prisma.personalEquipmentIssue.findMany({ where, include: { user: { select: public_user_1.PUBLIC_USER_SELECT }, issuedBy: { select: public_user_1.PUBLIC_USER_SELECT }, receivedBy: { select: public_user_1.PUBLIC_USER_SELECT } }, orderBy: [{ issuedAt: "desc" }, { id: "desc" }], skip: (page - 1) * pageSize, take: pageSize }),
        prisma_1.prisma.personalEquipmentIssue.count({ where }),
    ], { isolationLevel: "RepeatableRead" });
    return { issues, total, page, pageSize };
}
async function createPersonalEquipment(input, actorUserId) {
    return (0, transaction_1.serializable)(async (tx) => {
        const item = await tx.personalEquipment.create({ data: { code: input.code, category: input.category, size: input.size || null, asset: { create: { name: input.name, assetType: "PPE", status: "MAINTENANCE" } } } });
        await audit(tx, actorUserId, "PERSONAL_EQUIPMENT_CREATED", item.id, { code: item.code });
        return item;
    });
}
async function updatePersonalEquipment(id, input, actorUserId) {
    return (0, transaction_1.serializable)(async (tx) => {
        const item = await load(tx, id);
        if (item.issues.length)
            throw new operations_schemas_1.OperationError(409, "Registre la devolucion antes de editar el elemento");
        if (input.category !== item.category && await tx.personalEquipmentIssue.count({ where: { equipmentId: id } }))
            throw new operations_schemas_1.OperationError(409, "No puede cambiar la categoria de un elemento con entregas historicas");
        await claim(tx, id, input.revision);
        await tx.personalEquipment.update({ where: { id }, data: { category: input.category, size: input.size || null } });
        await tx.asset.update({ where: { id: item.assetId }, data: { name: input.name } });
        await audit(tx, actorUserId, "PERSONAL_EQUIPMENT_UPDATED", id);
        return { message: "Elemento actualizado" };
    });
}
async function checkPersonalEquipment(id, input, actorUserId) {
    return (0, transaction_1.serializable)(async (tx) => {
        const item = await load(tx, id);
        if (item.issues.length)
            throw new operations_schemas_1.OperationError(409, "Registre la devolucion antes de revisar el elemento");
        if (input.condition === "OK" && item.asset.maintenanceJobs.length)
            throw new operations_schemas_1.OperationError(409, "Debe cerrar el mantenimiento bloqueante antes de habilitar el elemento");
        await claim(tx, id, input.revision);
        const check = await tx.personalEquipmentCheck.create({ data: { equipmentId: id, checkedByUserId: actorUserId, condition: input.condition, notes: input.notes } });
        await tx.asset.update({ where: { id: item.assetId }, data: { status: input.condition === "OK" ? "OPERATIONAL" : input.condition === "OUT" ? "OUT_OF_SERVICE" : "MAINTENANCE", lastCheckDate: check.checkedAt } });
        await audit(tx, actorUserId, "PERSONAL_EQUIPMENT_CHECKED", id, { checkId: check.id, condition: input.condition });
        return check;
    });
}
async function issuePersonalEquipment(id, input, actorUserId) {
    return (0, transaction_1.serializable)(async (tx) => {
        const item = await load(tx, id);
        if (item.issues.length)
            throw new operations_schemas_1.OperationError(409, "El elemento ya esta entregado");
        const degraded = item.asset.status !== "OPERATIONAL" || item.asset.maintenanceJobs.length > 0 || item.checks[0]?.condition !== "OK";
        // P06: un EPP danado o vencido solo se entrega con aprobacion excepcional del jefe (oficial), con motivo.
        if (degraded) {
            const chief = await tx.user.findUnique({ where: { id: actorUserId }, select: { profile: { select: { rank: true } } } });
            if (!input.exceptionReason || (0, firefighter_ranks_1.normalizeRank)(chief?.profile?.rank) !== "oficial")
                throw new operations_schemas_1.OperationError(409, "El elemento está dañado, vencido o en revisión: solo un oficial puede entregarlo de forma excepcional indicando el motivo");
        }
        else if (input.exceptionReason)
            throw new operations_schemas_1.OperationError(400, "La aprobación excepcional solo aplica a elementos dañados o vencidos");
        const user = await tx.user.findFirst({ where: { id: input.userId, isActive: true, isPendingApproval: false, deletedAt: null }, select: { id: true } });
        if (!user)
            throw new operations_schemas_1.OperationError(400, "El integrante no esta habilitado");
        if (input.requestId) {
            const request = await tx.personalEquipmentRequest.findUnique({ where: { id: input.requestId } });
            if (!request || request.status !== "APPROVED" || request.revision !== input.requestRevision || request.userId !== input.userId || request.category !== item.category ||
                request.size && request.size.normalize("NFKC").trim().toUpperCase() !== (item.size || "").normalize("NFKC").trim().toUpperCase()) {
                throw new operations_schemas_1.OperationError(409, "El pedido no esta aprobado o no coincide con el integrante, categoria y talle");
            }
        }
        await claim(tx, id, input.revision);
        const issue = await tx.personalEquipmentIssue.create({ data: { equipmentId: id, userId: user.id, issuedByUserId: actorUserId, issueNotes: input.notes || null } });
        if (input.requestId) {
            const fulfilled = await tx.personalEquipmentRequest.updateMany({ where: { id: input.requestId, revision: input.requestRevision, status: "APPROVED" }, data: { status: "FULFILLED", fulfilledIssueId: issue.id, fulfilledAt: issue.issuedAt, revision: { increment: 1 } } });
            if (!fulfilled.count)
                throw new operations_schemas_1.OperationError(409, "El pedido cambio antes de registrar la entrega");
            await tx.auditLog.create({ data: { actorUserId, action: "EQUIPMENT_REQUEST_FULFILLED", entityType: "PersonalEquipmentRequest", entityId: input.requestId, metadata: { issueId: issue.id, equipmentId: id } } });
        }
        await audit(tx, actorUserId, degraded ? "PERSONAL_EQUIPMENT_ISSUED_EXCEPTION" : "PERSONAL_EQUIPMENT_ISSUED", id, { issueId: issue.id, userId: user.id, ...(degraded ? { exceptionReason: input.exceptionReason } : {}) });
        // P04: la entrega queda pendiente hasta que el titular la acepte.
        await (0, notifications_service_1.notify)(tx, [user.id], `Confirme la recepción de ${item.asset.name}`, "/me?tab=clothing", input.notes || undefined);
        return issue;
    });
}
async function returnPersonalEquipment(id, input, actorUserId) {
    return (0, transaction_1.serializable)(async (tx) => {
        const item = await load(tx, id);
        const current = item.issues[0];
        if (!current || current.id !== input.issueId)
            throw new operations_schemas_1.OperationError(409, "La entrega ya fue devuelta o no corresponde al elemento");
        await claim(tx, id, input.revision);
        const returned = await tx.personalEquipmentIssue.updateMany({ where: { id: current.id, equipmentId: id, returnedAt: null }, data: { returnedAt: new Date(), receivedByUserId: actorUserId, returnCondition: input.condition, returnNotes: input.notes || null } });
        if (!returned.count)
            throw new operations_schemas_1.OperationError(409, "La entrega ya fue devuelta");
        // A return is a custody event, not a new physical approval for emergency use.
        await tx.asset.update({ where: { id: item.assetId }, data: { status: input.condition === "OUT" || item.asset.status === "OUT_OF_SERVICE" ? "OUT_OF_SERVICE" : "MAINTENANCE" } });
        await audit(tx, actorUserId, "PERSONAL_EQUIPMENT_RETURNED", id, { issueId: current.id, condition: input.condition });
        return { message: "Devolucion registrada. El elemento requiere revision antes de otra entrega." };
    });
}
async function archivePersonalEquipment(id, revision, actorUserId) {
    return (0, transaction_1.serializable)(async (tx) => {
        const item = await load(tx, id);
        if (item.issues.length)
            throw new operations_schemas_1.OperationError(409, "No puede dar de baja un elemento entregado");
        await claim(tx, id, revision);
        await tx.personalEquipment.update({ where: { id }, data: { archivedAt: new Date() } });
        await tx.asset.update({ where: { id: item.assetId }, data: { status: "OUT_OF_SERVICE" } });
        await audit(tx, actorUserId, "PERSONAL_EQUIPMENT_ARCHIVED", id);
        return { message: "Baja registrada. El historial se conserva." };
    });
}
