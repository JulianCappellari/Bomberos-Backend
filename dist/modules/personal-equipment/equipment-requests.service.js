"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listEquipmentRequests = listEquipmentRequests;
exports.createEquipmentRequest = createEquipmentRequest;
exports.editEquipmentRequest = editEquipmentRequest;
exports.reviewEquipmentRequest = reviewEquipmentRequest;
exports.cancelEquipmentRequest = cancelEquipmentRequest;
const prisma_1 = require("../../config/prisma");
const transaction_1 = require("../../utils/transaction");
const public_user_1 = require("../../utils/public-user");
const operations_schemas_1 = require("../operations/operations.schemas");
const include = { user: { select: public_user_1.PUBLIC_USER_SELECT }, reviewedBy: { select: public_user_1.PUBLIC_USER_SELECT }, fulfilledIssue: { select: { id: true, issuedAt: true, equipment: { select: { code: true, asset: { select: { name: true } } } } } } };
async function listEquipmentRequests(filters, actor) {
    if (!(0, operations_schemas_1.isOperationsManager)(actor.role) && filters.userId && filters.userId !== actor.userId)
        throw new operations_schemas_1.OperationError(403, "Solo puede consultar sus propios pedidos");
    const where = { ...(filters.status ? { status: filters.status } : {}), ...(!(0, operations_schemas_1.isOperationsManager)(actor.role) ? { userId: actor.userId } : filters.userId ? { userId: filters.userId } : {}) };
    const [items, total] = await prisma_1.prisma.$transaction([
        prisma_1.prisma.personalEquipmentRequest.findMany({ where, include, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (filters.page - 1) * 30, take: 30 }),
        prisma_1.prisma.personalEquipmentRequest.count({ where }),
    ], { isolationLevel: "RepeatableRead" });
    return { items, total, page: filters.page, pageSize: 30 };
}
async function createEquipmentRequest(input, userId) {
    return (0, transaction_1.serializable)(async (tx) => {
        const active = await tx.personalEquipmentRequest.findFirst({ where: { userId, category: input.category, status: { in: ["PENDING", "APPROVED"] } }, select: { id: true } });
        if (active)
            throw new operations_schemas_1.OperationError(409, "Ya tiene un pedido activo para esta categoria");
        const request = await tx.personalEquipmentRequest.create({ data: { ...input, size: input.size || null, userId }, include });
        await tx.auditLog.create({ data: { actorUserId: userId, action: "EQUIPMENT_REQUEST_CREATED", entityType: "PersonalEquipmentRequest", entityId: request.id } });
        return request;
    });
}
async function editEquipmentRequest(id, input, actor) {
    return (0, transaction_1.serializable)(async (tx) => {
        const request = await tx.personalEquipmentRequest.findUnique({ where: { id }, select: { userId: true } });
        if (!request || request.userId !== actor.userId)
            throw new operations_schemas_1.OperationError(404, "Pedido no encontrado");
        const changed = await tx.personalEquipmentRequest.updateMany({ where: { id, userId: actor.userId, status: "PENDING", revision: input.revision }, data: { category: input.category, size: input.size || null, reason: input.reason, revision: { increment: 1 } } });
        if (!changed.count)
            throw new operations_schemas_1.OperationError(409, "El pedido ya fue revisado o cambio. Actualice la lista.");
        await tx.auditLog.create({ data: { actorUserId: actor.userId, action: "EQUIPMENT_REQUEST_EDITED", entityType: "PersonalEquipmentRequest", entityId: id } });
        return tx.personalEquipmentRequest.findUniqueOrThrow({ where: { id }, include });
    });
}
async function reviewEquipmentRequest(id, input, actor) {
    if (!(0, operations_schemas_1.isOperationsManager)(actor.role))
        throw new operations_schemas_1.OperationError(403, "No tiene permisos para revisar pedidos");
    return (0, transaction_1.serializable)(async (tx) => {
        const request = await tx.personalEquipmentRequest.findUnique({ where: { id } });
        if (!request)
            throw new operations_schemas_1.OperationError(404, "Pedido no encontrado");
        if (request.userId === actor.userId)
            throw new operations_schemas_1.OperationError(403, "Otro responsable debe revisar su pedido");
        const changed = await tx.personalEquipmentRequest.updateMany({ where: { id, revision: input.revision, status: "PENDING" }, data: { status: input.status, reviewedByUserId: actor.userId, reviewedAt: new Date(), reviewNotes: input.notes, revision: { increment: 1 } } });
        if (!changed.count)
            throw new operations_schemas_1.OperationError(409, "El pedido ya fue revisado o cambio. Actualice la lista.");
        await tx.auditLog.create({ data: { actorUserId: actor.userId, action: `EQUIPMENT_REQUEST_${input.status}`, entityType: "PersonalEquipmentRequest", entityId: id } });
        return tx.personalEquipmentRequest.findUniqueOrThrow({ where: { id }, include });
    });
}
async function cancelEquipmentRequest(id, revision, actor) {
    return (0, transaction_1.serializable)(async (tx) => {
        const request = await tx.personalEquipmentRequest.findUnique({ where: { id }, select: { userId: true } });
        if (!request || request.userId !== actor.userId)
            throw new operations_schemas_1.OperationError(404, "Pedido no encontrado");
        const changed = await tx.personalEquipmentRequest.updateMany({ where: { id, userId: actor.userId, revision, status: { in: ["PENDING", "APPROVED"] } }, data: { status: "CANCELLED", revision: { increment: 1 } } });
        if (!changed.count)
            throw new operations_schemas_1.OperationError(409, "El pedido ya fue cerrado o cambio. Actualice la lista.");
        await tx.auditLog.create({ data: { actorUserId: actor.userId, action: "EQUIPMENT_REQUEST_CANCELLED", entityType: "PersonalEquipmentRequest", entityId: id } });
        return { message: "Pedido cancelado; historial conservado" };
    });
}
