"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.groupSchema = void 0;
exports.nextControlWeek = nextControlWeek;
exports.groups = groups;
exports.controlEligibility = controlEligibility;
exports.saveGroup = saveGroup;
exports.syncControlReminder = syncControlReminder;
const zod_1 = require("zod");
const prisma_1 = require("../../config/prisma");
const transaction_1 = require("../../utils/transaction");
const public_user_1 = require("../../utils/public-user");
const operations_schemas_1 = require("../operations/operations.schemas");
const station_time_1 = require("../../utils/station-time");
exports.groupSchema = zod_1.z.object({ name: zod_1.z.string().trim().min(3).max(100), startsOn: zod_1.z.string().date(), repeatWeeks: zod_1.z.number().int().min(1).max(52), userIds: zod_1.z.array(zod_1.z.string().min(1)).max(40).refine((ids) => new Set(ids).size === ids.length, "No repita integrantes"), revision: zod_1.z.number().int().positive().optional() }).strict();
function nextControlWeek(anchor, repeatWeeks, today) {
    const days = Math.floor((today.getTime() - anchor.getTime()) / 86400000), cycle = repeatWeeks * 7;
    const count = days < 0 ? 0 : Math.floor(days / cycle) + (days % cycle >= 7 ? 1 : 0);
    const start = new Date(anchor.getTime() + count * cycle * 86400000);
    return { start, end: new Date(start.getTime() + 7 * 86400000), current: today >= start && today < new Date(start.getTime() + 7 * 86400000) };
}
async function groups(actor) {
    const rows = await prisma_1.prisma.controlGroup.findMany({ where: actor.role === "ADMIN" ? {} : { members: { some: { userId: actor.userId } } }, include: { members: { include: { user: { select: public_user_1.PUBLIC_USER_SELECT } } } }, orderBy: { name: "asc" } });
    const today = new Date((0, station_time_1.stationDate)() + "T00:00:00Z");
    return rows.map((row) => ({ ...row, next: nextControlWeek(row.startsOn, row.repeatWeeks, today) }));
}
async function controlEligibility(actor) {
    const member = await prisma_1.prisma.controlGroupMember.findUnique({ where: { userId: actor.userId }, include: { group: { include: { members: { where: { user: { isActive: true, isPendingApproval: false, deletedAt: null } }, include: { user: { select: public_user_1.PUBLIC_USER_SELECT } } } } } } });
    if (!member)
        return { allowed: false, group: null, week: null, reason: "No pertenece a un grupo de control" };
    const week = nextControlWeek(member.group.startsOn, member.group.repeatWeeks, new Date((0, station_time_1.stationDate)() + "T00:00:00Z"));
    return { allowed: week.current, group: member.group, week, reason: week.current ? null : "Esta semana no corresponde a su grupo" };
}
async function saveGroup(id, input, actor) {
    if (actor.role !== "ADMIN")
        throw new operations_schemas_1.OperationError(403, "Solo administracion gestiona grupos");
    return (0, transaction_1.serializable)(async (tx) => {
        if (await tx.user.count({ where: { id: { in: input.userIds }, isActive: true, isPendingApproval: false, deletedAt: null } }) !== input.userIds.length)
            throw new operations_schemas_1.OperationError(400, "Seleccione integrantes activos");
        let groupId = id;
        if (id) {
            if (!input.revision)
                throw new operations_schemas_1.OperationError(400, "Falta revision del grupo");
            const changed = await tx.controlGroup.updateMany({ where: { id, revision: input.revision }, data: { name: input.name, startsOn: new Date(input.startsOn), repeatWeeks: input.repeatWeeks, revision: { increment: 1 } } });
            if (!changed.count)
                throw new operations_schemas_1.OperationError(409, "El grupo cambio, recargue antes de editar");
            await tx.controlGroupMember.deleteMany({ where: { groupId: id } });
        }
        else
            groupId = (await tx.controlGroup.create({ data: { name: input.name, startsOn: new Date(input.startsOn), repeatWeeks: input.repeatWeeks } })).id;
        await tx.controlGroupMember.createMany({ data: input.userIds.map((userId) => ({ userId, groupId: groupId })) });
        await tx.auditLog.create({ data: { actorUserId: actor.userId, action: "CONTROL_GROUP_SAVED", entityType: "ControlGroup", entityId: groupId, metadata: { userIds: input.userIds, repeatWeeks: input.repeatWeeks, startsOn: input.startsOn } } });
        return { id: groupId };
    });
}
async function syncControlReminder(userId) {
    const member = await prisma_1.prisma.controlGroupMember.findUnique({ where: { userId }, include: { group: true, user: { select: { isActive: true, deletedAt: true, isPendingApproval: true } } } });
    if (!member || !member.user.isActive || member.user.deletedAt || member.user.isPendingApproval)
        return;
    const today = new Date((0, station_time_1.stationDate)() + "T00:00:00Z"), week = nextControlWeek(member.group.startsOn, member.group.repeatWeeks, today);
    if (week.start.getTime() - today.getTime() > 7 * 86400000)
        return;
    const key = `control:${member.groupId}:${week.start.toISOString().slice(0, 10)}:${userId}`;
    await prisma_1.prisma.memberNotification.upsert({ where: { dedupeKey: key }, update: {}, create: { userId, dedupeKey: key, title: `${member.group.name}: control desde ${week.start.toISOString().slice(0, 10)}`, href: "/vehicle-control" } });
}
