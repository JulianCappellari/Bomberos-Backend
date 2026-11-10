import { z } from "zod";
import { prisma } from "../../config/prisma";
import { serializable } from "../../utils/transaction";
import { PUBLIC_USER_SELECT } from "../../utils/public-user";
import { isOperationsManager, OperationError } from "../operations/operations.schemas";
import { createEquipmentRequestSchema, editEquipmentRequestSchema, reviewEquipmentRequestSchema, equipmentRequestListSchema } from "./equipment-requests.schemas";
type Actor = { userId: string; role: string };
const include = { user: { select: PUBLIC_USER_SELECT }, reviewedBy: { select: PUBLIC_USER_SELECT }, fulfilledIssue: { select: { id: true, issuedAt: true, equipment: { select: { code: true, asset: { select: { name: true } } } } } } };
export async function listEquipmentRequests(filters: z.infer<typeof equipmentRequestListSchema>, actor: Actor) {
  if (!isOperationsManager(actor.role) && filters.userId && filters.userId !== actor.userId) throw new OperationError(403, "Solo puede consultar sus propios pedidos");
  const where = { ...(filters.status ? { status: filters.status } : {}), ...(!isOperationsManager(actor.role) ? { userId: actor.userId } : filters.userId ? { userId: filters.userId } : {}) };
  const [items, total] = await prisma.$transaction([
    prisma.personalEquipmentRequest.findMany({ where, include, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (filters.page - 1) * 30, take: 30 }),
    prisma.personalEquipmentRequest.count({ where }),
  ], { isolationLevel: "RepeatableRead" });
  return { items, total, page: filters.page, pageSize: 30 };
}
export async function createEquipmentRequest(input: z.infer<typeof createEquipmentRequestSchema>, userId: string) {
  return serializable(async (tx) => {
    const active = await tx.personalEquipmentRequest.findFirst({ where: { userId, category: input.category, status: { in: ["PENDING", "APPROVED"] } }, select: { id: true } });
    if (active) throw new OperationError(409, "Ya tiene un pedido activo para esta categoria");
    const request = await tx.personalEquipmentRequest.create({ data: { ...input, size: input.size || null, userId }, include });
    await tx.auditLog.create({ data: { actorUserId: userId, action: "EQUIPMENT_REQUEST_CREATED", entityType: "PersonalEquipmentRequest", entityId: request.id } });
    return request;
  });
}
export async function editEquipmentRequest(id: string, input: z.infer<typeof editEquipmentRequestSchema>, actor: Actor) {
  return serializable(async (tx) => {
    const request = await tx.personalEquipmentRequest.findUnique({ where: { id }, select: { userId: true } });
    if (!request || request.userId !== actor.userId) throw new OperationError(404, "Pedido no encontrado");
    const changed = await tx.personalEquipmentRequest.updateMany({ where: { id, userId: actor.userId, status: "PENDING", revision: input.revision }, data: { category: input.category, size: input.size || null, reason: input.reason, revision: { increment: 1 } } });
    if (!changed.count) throw new OperationError(409, "El pedido ya fue revisado o cambio. Actualice la lista.");
    await tx.auditLog.create({ data: { actorUserId: actor.userId, action: "EQUIPMENT_REQUEST_EDITED", entityType: "PersonalEquipmentRequest", entityId: id } });
    return tx.personalEquipmentRequest.findUniqueOrThrow({ where: { id }, include });
  });
}
export async function reviewEquipmentRequest(id: string, input: z.infer<typeof reviewEquipmentRequestSchema>, actor: Actor) {
  if (!isOperationsManager(actor.role)) throw new OperationError(403, "No tiene permisos para revisar pedidos");
  return serializable(async (tx) => {
    const request = await tx.personalEquipmentRequest.findUnique({ where: { id } });
    if (!request) throw new OperationError(404, "Pedido no encontrado");
    if (request.userId === actor.userId) throw new OperationError(403, "Otro responsable debe revisar su pedido");
    const changed = await tx.personalEquipmentRequest.updateMany({ where: { id, revision: input.revision, status: "PENDING" }, data: { status: input.status, reviewedByUserId: actor.userId, reviewedAt: new Date(), reviewNotes: input.notes, revision: { increment: 1 } } });
    if (!changed.count) throw new OperationError(409, "El pedido ya fue revisado o cambio. Actualice la lista.");
    await tx.auditLog.create({ data: { actorUserId: actor.userId, action: `EQUIPMENT_REQUEST_${input.status}`, entityType: "PersonalEquipmentRequest", entityId: id } });
    return tx.personalEquipmentRequest.findUniqueOrThrow({ where: { id }, include });
  });
}
export async function cancelEquipmentRequest(id: string, revision: number, actor: Actor) {
  return serializable(async (tx) => {
    const request = await tx.personalEquipmentRequest.findUnique({ where: { id }, select: { userId: true } });
    if (!request || request.userId !== actor.userId) throw new OperationError(404, "Pedido no encontrado");
    const changed = await tx.personalEquipmentRequest.updateMany({ where: { id, userId: actor.userId, revision, status: { in: ["PENDING", "APPROVED"] } }, data: { status: "CANCELLED", revision: { increment: 1 } } });
    if (!changed.count) throw new OperationError(409, "El pedido ya fue cerrado o cambio. Actualice la lista.");
    await tx.auditLog.create({ data: { actorUserId: actor.userId, action: "EQUIPMENT_REQUEST_CANCELLED", entityType: "PersonalEquipmentRequest", entityId: id } });
    return { message: "Pedido cancelado; historial conservado" };
  });
}
