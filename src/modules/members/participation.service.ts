import { z } from "zod";
import { prisma } from "../../config/prisma";
import { serializable } from "../../utils/transaction";
import { PUBLIC_USER_SELECT } from "../../utils/public-user";
import { OperationError, isOperationsManager } from "../operations/operations.schemas";
import { Actor } from "../work/work.schemas";
import { shiftInterval } from "../shifts/shifts.rules";
import { notify } from "./notifications.service";
export const participationSchema = z.object({
  userId: z.string().min(1).max(100), shiftId: z.string().min(1).max(100).optional(), incidentId: z.string().min(1).max(100).optional(),
  startedAt: z.string().datetime({ offset: true }), endedAt: z.string().datetime({ offset: true }), notes: z.string().trim().min(10).max(2000),
}).strict().refine((v) => Boolean(v.shiftId) !== Boolean(v.incidentId), "Seleccione una guardia o una intervencion, no ambas").refine((v) => new Date(v.endedAt) > new Date(v.startedAt), "La salida debe ser posterior al ingreso");
export const cancelParticipationSchema = z.object({ revision: z.number().int().positive(), reason: z.string().trim().min(10).max(2000) }).strict();
export function validateParticipationInterval(start: Date, end: Date, bounds: { start: number; end: number }, now = new Date()) {
  if (start >= end || end > now || start.getTime() < bounds.start || end.getTime() > bounds.end) throw new OperationError(400, "La asistencia debe estar dentro del servicio y no puede ser futura");
}
export async function listParticipations(userId: string, page: number, actor: Actor) {
  if (!isOperationsManager(actor.role)) throw new OperationError(403, "Solo mando puede consultar registros de asistencias");
  return prisma.$transaction(async (tx) => {
    const where = { userId };
    if (actor.userId !== userId) await tx.auditLog.create({ data: { actorUserId: actor.userId, action: "SERVICE_ATTENDANCE_VIEWED", entityType: "User", entityId: userId } });
    const items = await tx.serviceParticipation.findMany({ where, include: { user: { select: PUBLIC_USER_SELECT }, registeredBy: { select: PUBLIC_USER_SELECT }, shift: { select: { date: true, shiftType: true } }, incident: { select: { title: true } } }, orderBy: [{ startedAt: "desc" }, { id: "desc" }], skip: (page - 1) * 30, take: 30 });
    return { items, total: await tx.serviceParticipation.count({ where }), page, pageSize: 30 };
  }, { isolationLevel: "RepeatableRead" });
}
export async function recordParticipation(input: z.infer<typeof participationSchema>, actor: Actor) {
  if (!isOperationsManager(actor.role) && input.userId !== actor.userId) throw new OperationError(403, "Solo puede informar su propia asistencia");
  return serializable(async (tx) => {
    if (!await tx.user.findFirst({ where: { id: input.userId, deletedAt: null, isActive: true, isPendingApproval: false }, select: { id: true } })) throw new OperationError(400, "El integrante no esta activo");
    const start = new Date(input.startedAt), end = new Date(input.endedAt);
    if (input.shiftId) {
      const shift = await tx.shift.findUnique({ where: { id: input.shiftId }, include: { assignments: { where: { userId: input.userId }, select: { id: true } } } });
      if (!shift || !shift.assignments.length) throw new OperationError(400, "La persona debe estar asignada a la guardia");
      validateParticipationInterval(start, end, shiftInterval(shift.date.toISOString().slice(0, 10), shift.startTime, shift.endTime));
    } else {
      const incident = await tx.incident.findUnique({ where: { id: input.incidentId! }, include: { assignments: { where: { userId: input.userId }, select: { id: true } } } });
      if (!incident || !incident.assignments.length || !incident.closedAt || incident.status !== "CLOSED") throw new OperationError(400, "La intervencion debe estar cerrada y la persona asignada");
      validateParticipationInterval(start, end, { start: incident.occurredAt.getTime(), end: incident.closedAt.getTime() });
    }
    const exists = await tx.serviceParticipation.findFirst({ where: { userId: input.userId, cancelledAt: null, ...(input.shiftId ? { shiftId: input.shiftId } : { incidentId: input.incidentId }) } });
    if (exists) throw new OperationError(409, "Ya existe asistencia activa para ese servicio; anule con motivo si debe corregirla");
    // An emergency can happen during a shift; totals merge both time intervals.
    const overlap = await tx.serviceParticipation.findFirst({ where: { userId: input.userId, cancelledAt: null, ...(input.shiftId ? { shiftId: { not: null } } : { incidentId: { not: null } }), startedAt: { lt: end }, endedAt: { gt: start } } });
    if (overlap) throw new OperationError(409, "La asistencia se superpone con otra guardia o intervencion del mismo tipo");
    const row = await tx.serviceParticipation.create({ data: { ...input, startedAt: start, endedAt: end, registeredByUserId: actor.userId, verifiedAt: isOperationsManager(actor.role) ? new Date() : null } });
    await notify(tx, [input.userId], "Se registro su asistencia a un servicio", "/participations");
    await tx.auditLog.create({ data: { actorUserId: actor.userId, action: "SERVICE_ATTENDANCE_RECORDED", entityType: "ServiceParticipation", entityId: row.id, metadata: { snapshot: JSON.parse(JSON.stringify(row)) } } });
    return row;
  });
}
export async function cancelParticipation(id: string, input: z.infer<typeof cancelParticipationSchema>, actor: Actor) {
  if (!isOperationsManager(actor.role)) throw new OperationError(403, "Solo mando puede anular asistencias");
  return serializable(async (tx) => {
    const changed = await tx.serviceParticipation.updateMany({ where: { id, revision: input.revision, cancelledAt: null }, data: { cancelledAt: new Date(), cancelReason: input.reason, revision: { increment: 1 } } });
    if (!changed.count) throw new OperationError(409, "La asistencia cambio o ya fue anulada");
    await tx.auditLog.create({ data: { actorUserId: actor.userId, action: "SERVICE_ATTENDANCE_CANCELLED", entityType: "ServiceParticipation", entityId: id, metadata: { reason: input.reason } } });
    return { message: "Asistencia anulada; se conserva el registro" };
  });
}
export async function verifyParticipation(id: string, revision: number, actor: Actor) {
  if (!isOperationsManager(actor.role)) throw new OperationError(403, "Solo mando verifica asistencias informadas");
  return serializable(async (tx) => {
    if (!(await tx.serviceParticipation.updateMany({ where: { id, revision, verifiedAt: null, cancelledAt: null, registeredByUserId: { not: actor.userId } }, data: { verifiedAt: new Date(), revision: { increment: 1 } } })).count) throw new OperationError(409, "El registro cambio, ya fue verificado o requiere verificacion independiente");
    await tx.auditLog.create({ data: { actorUserId: actor.userId, action: "SERVICE_ATTENDANCE_VERIFIED", entityType: "ServiceParticipation", entityId: id } });
    return { message: "Asistencia verificada y acreditada" };
  });
}
