import { z } from "zod";
import { prisma } from "../../config/prisma";
import { serializable } from "../../utils/transaction";
import { PUBLIC_USER_SELECT } from "../../utils/public-user";
import { Actor } from "../work/work.schemas";
import { OperationError } from "../operations/operations.schemas";
import { stationDate } from "../../utils/station-time";
export const groupSchema = z.object({ name: z.string().trim().min(3).max(100), startsOn: z.string().date(), repeatWeeks: z.number().int().min(1).max(52), userIds: z.array(z.string().min(1)).max(40).refine((ids) => new Set(ids).size === ids.length, "No repita integrantes"), revision: z.number().int().positive().optional() }).strict();
export function nextControlWeek(anchor: Date, repeatWeeks: number, today: Date) {
  const days = Math.floor((today.getTime() - anchor.getTime()) / 86400000), cycle = repeatWeeks * 7;
  const count = days < 0 ? 0 : Math.floor(days / cycle) + (days % cycle >= 7 ? 1 : 0);
  const start = new Date(anchor.getTime() + count * cycle * 86400000);
  return { start, end: new Date(start.getTime() + 7 * 86400000), current: today >= start && today < new Date(start.getTime() + 7 * 86400000) };
}
export async function groups(actor: Actor) {
  const rows = await prisma.controlGroup.findMany({ where: actor.role === "ADMIN" ? {} : { members: { some: { userId: actor.userId } } }, include: { members: { include: { user: { select: PUBLIC_USER_SELECT } } } }, orderBy: { name: "asc" } });
  const today = new Date(stationDate() + "T00:00:00Z");
  return rows.map((row) => ({ ...row, next: nextControlWeek(row.startsOn, row.repeatWeeks, today) }));
}
export async function controlEligibility(actor: Actor) {
  const member = await prisma.controlGroupMember.findUnique({ where: { userId: actor.userId }, include: { group: { include: { members: { where: { user: { isActive: true, isPendingApproval: false, deletedAt: null } }, include: { user: { select: PUBLIC_USER_SELECT } } } } } } });
  if (!member) return { allowed: false, group: null, week: null, reason: "No pertenece a un grupo de control" };
  const week = nextControlWeek(member.group.startsOn, member.group.repeatWeeks, new Date(stationDate() + "T00:00:00Z"));
  return { allowed: week.current, group: member.group, week, reason: week.current ? null : "Esta semana no corresponde a su grupo" };
}
export async function saveGroup(id: string | null, input: z.infer<typeof groupSchema>, actor: Actor) {
  if (actor.role !== "ADMIN") throw new OperationError(403, "Solo administracion gestiona grupos");
  return serializable(async (tx) => {
    if (await tx.user.count({ where: { id: { in: input.userIds }, isActive: true, isPendingApproval: false, deletedAt: null } }) !== input.userIds.length) throw new OperationError(400, "Seleccione integrantes activos");
    let groupId = id;
    if (id) {
      if (!input.revision) throw new OperationError(400, "Falta revision del grupo");
      const changed = await tx.controlGroup.updateMany({ where: { id, revision: input.revision }, data: { name: input.name, startsOn: new Date(input.startsOn), repeatWeeks: input.repeatWeeks, revision: { increment: 1 } } });
      if (!changed.count) throw new OperationError(409, "El grupo cambio, recargue antes de editar");
      await tx.controlGroupMember.deleteMany({ where: { groupId: id } });
    } else groupId = (await tx.controlGroup.create({ data: { name: input.name, startsOn: new Date(input.startsOn), repeatWeeks: input.repeatWeeks } })).id;
    await tx.controlGroupMember.createMany({ data: input.userIds.map((userId) => ({ userId, groupId: groupId! })) });
    await tx.auditLog.create({ data: { actorUserId: actor.userId, action: "CONTROL_GROUP_SAVED", entityType: "ControlGroup", entityId: groupId!, metadata: { userIds: input.userIds, repeatWeeks: input.repeatWeeks, startsOn: input.startsOn } } });
    return { id: groupId };
  });
}
export async function syncControlReminder(userId: string) {
  const member = await prisma.controlGroupMember.findUnique({ where: { userId }, include: { group: true, user: { select: { isActive: true, deletedAt: true, isPendingApproval: true } } } });
  if (!member || !member.user.isActive || member.user.deletedAt || member.user.isPendingApproval) return;
  const today = new Date(stationDate() + "T00:00:00Z"), week = nextControlWeek(member.group.startsOn, member.group.repeatWeeks, today);
  if (week.start.getTime() - today.getTime() > 7 * 86400000) return;
  const key = `control:${member.groupId}:${week.start.toISOString().slice(0, 10)}:${userId}`;
  await prisma.memberNotification.upsert({ where: { dedupeKey: key }, update: {}, create: { userId, dedupeKey: key, title: `${member.group.name}: control desde ${week.start.toISOString().slice(0, 10)}`, href: "/vehicle-control" } });
}
