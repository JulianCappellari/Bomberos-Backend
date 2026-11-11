"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.notify = notify;
exports.commandUserIds = commandUserIds;
exports.notifyCommand = notifyCommand;
exports.notifications = notifications;
exports.readAllNotifications = readAllNotifications;
exports.readNotification = readNotification;
const prisma_1 = require("../../config/prisma");
const operations_schemas_1 = require("../operations/operations.schemas");
const groups_service_1 = require("./groups.service");
const firefighter_ranks_1 = require("../../utils/firefighter-ranks");
async function notify(tx, userIds, title, href, body) {
    if (!userIds.length)
        return;
    await tx.memberNotification.createMany({ data: [...new Set(userIds)].map((userId) => ({ userId, title: title.slice(0, 160), href, body: body?.slice(0, 2000) || null })) });
}
// F13/S07: jefatura (Oficial y Sub oficial activos) recibe los eventos de notificacion obligatoria.
async function commandUserIds(tx, exceptUserId) {
    const people = await tx.user.findMany({ where: { isActive: true, isPendingApproval: false, deletedAt: null }, select: { id: true, profile: { select: { rank: true } } } });
    return people.filter(person => person.id !== exceptUserId && ["oficial", "suboficial"].includes((0, firefighter_ranks_1.normalizeRank)(person.profile?.rank).replace(/\s/g, ""))).map(person => person.id);
}
async function notifyCommand(tx, title, href, body, exceptUserId) {
    await notify(tx, await commandUserIds(tx, exceptUserId), title, href, body);
}
async function notifications(userId, page) {
    await (0, groups_service_1.syncControlReminder)(userId);
    const where = { userId };
    const [items, total, unread] = await prisma_1.prisma.$transaction([
        prisma_1.prisma.memberNotification.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 30, skip: (page - 1) * 30 }),
        prisma_1.prisma.memberNotification.count({ where }), prisma_1.prisma.memberNotification.count({ where: { ...where, readAt: null } }),
    ], { isolationLevel: "RepeatableRead" });
    return { items, total, unread };
}
// Marca todas las pendientes de una vez; una sola entrada de auditoria con la cantidad.
async function readAllNotifications(userId) {
    return prisma_1.prisma.$transaction(async (tx) => {
        const changed = await tx.memberNotification.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } });
        if (changed.count)
            await tx.auditLog.create({ data: { actorUserId: userId, action: "NOTIFICATION_READ_ALL", entityType: "MemberNotification", entityId: userId, metadata: { count: changed.count } } });
        return { message: "Notificaciones marcadas como leídas", count: changed.count };
    });
}
async function readNotification(id, userId) {
    return prisma_1.prisma.$transaction(async (tx) => {
        const row = await tx.memberNotification.findFirst({ where: { id, userId } });
        if (!row)
            throw new operations_schemas_1.OperationError(404, "Notificacion no encontrada");
        const changed = await tx.memberNotification.updateMany({ where: { id, userId, readAt: null }, data: { readAt: new Date() } });
        if (changed.count)
            await tx.auditLog.create({ data: { actorUserId: userId, action: "NOTIFICATION_READ", entityType: "MemberNotification", entityId: id } });
        return { message: "Notificacion marcada como leida" };
    });
}
