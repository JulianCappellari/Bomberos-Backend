import { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma";
import { OperationError } from "../operations/operations.schemas";
import { syncControlReminder } from "./groups.service";
import { normalizeRank } from "../../utils/firefighter-ranks";
export async function notify(tx: Prisma.TransactionClient, userIds: string[], title: string, href: string, body?: string) {
  if (!userIds.length) return;
  await tx.memberNotification.createMany({ data: [...new Set(userIds)].map((userId) => ({ userId, title: title.slice(0, 160), href, body: body?.slice(0, 2000) || null })) });
}
// F13/S07: jefatura (Oficial y Sub oficial activos) recibe los eventos de notificacion obligatoria.
export async function commandUserIds(tx: Prisma.TransactionClient, exceptUserId?: string) {
  const people = await tx.user.findMany({ where: { isActive: true, isPendingApproval: false, deletedAt: null }, select: { id: true, profile: { select: { rank: true } } } });
  return people.filter(person => person.id !== exceptUserId && ["oficial", "suboficial"].includes(normalizeRank(person.profile?.rank).replace(/\s/g, ""))).map(person => person.id);
}
export async function notifyCommand(tx: Prisma.TransactionClient, title: string, href: string, body?: string, exceptUserId?: string) {
  await notify(tx, await commandUserIds(tx, exceptUserId), title, href, body);
}
export async function notifications(userId: string, page: number) {
  await syncControlReminder(userId);
  const where = { userId };
  const [items, total, unread] = await prisma.$transaction([
    prisma.memberNotification.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 30, skip: (page - 1) * 30 }),
    prisma.memberNotification.count({ where }), prisma.memberNotification.count({ where: { ...where, readAt: null } }),
  ], { isolationLevel: "RepeatableRead" });
  return { items, total, unread };
}
// Marca todas las pendientes de una vez; una sola entrada de auditoria con la cantidad.
export async function readAllNotifications(userId: string) {
  return prisma.$transaction(async (tx) => {
    const changed = await tx.memberNotification.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } });
    if (changed.count) await tx.auditLog.create({ data: { actorUserId: userId, action: "NOTIFICATION_READ_ALL", entityType: "MemberNotification", entityId: userId, metadata: { count: changed.count } } });
    return { message: "Notificaciones marcadas como leídas", count: changed.count };
  });
}

export async function readNotification(id: string, userId: string) {
  return prisma.$transaction(async (tx) => {
    const row = await tx.memberNotification.findFirst({ where: { id, userId } });
    if (!row) throw new OperationError(404, "Notificacion no encontrada");
    const changed = await tx.memberNotification.updateMany({ where: { id, userId, readAt: null }, data: { readAt: new Date() } });
    if (changed.count) await tx.auditLog.create({ data: { actorUserId: userId, action: "NOTIFICATION_READ", entityType: "MemberNotification", entityId: id } });
    return { message: "Notificacion marcada como leida" };
  });
}
