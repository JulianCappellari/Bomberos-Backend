import { createHash } from "node:crypto";
import { z } from "zod";
import { prisma } from "../../config/prisma";
import { serializable } from "../../utils/transaction";
import { PUBLIC_USER_SELECT } from "../../utils/public-user";
import { Actor, assertPast } from "../work/work.schemas";
import { activePeople } from "../work/work.service";
import { OperationError, isDutyManager } from "../operations/operations.schemas";
import { notify } from "../members/notifications.service";
export const departureSchema = z.object({
  operationKey: z.string().uuid(), assetId: z.string().min(1), departedAt: z.string().datetime({ offset: true }), returnedAt: z.string().datetime({ offset: true }),
  purpose: z.string().trim().min(5).max(200), notes: z.string().trim().min(10).max(2000), leaderUserId: z.string().min(1), userIds: z.array(z.string().min(1)).min(1).max(40),
}).strict().refine((v) => new Date(v.returnedAt) > new Date(v.departedAt), "La vuelta debe ser posterior a la salida").refine((v) => v.userIds.includes(v.leaderUserId) && new Set(v.userIds).size === v.userIds.length, "El encargado debe integrar una dotacion sin personas repetidas");
const include = { asset: { select: { id: true, name: true } }, createdBy: { select: PUBLIC_USER_SELECT }, crew: { include: { user: { select: PUBLIC_USER_SELECT } } } };
function manager(actor: Actor) { if (!isDutyManager(actor.role)) throw new OperationError(403, "Solo mando autorizado registra actas de salida"); }
export async function listDepartures(page: number, actor: Actor) {
  const where = isDutyManager(actor.role) ? {} : { crew: { some: { userId: actor.userId } } };
  const [items, total] = await prisma.$transaction([prisma.vehicleDeparture.findMany({ where, include, orderBy: [{ departedAt: "desc" }, { id: "desc" }], skip: (page - 1) * 30, take: 30 }), prisma.vehicleDeparture.count({ where })], { isolationLevel: "RepeatableRead" });
  return { items: items.map(({ requestHash, operationKey, ...row }) => row), total, page, pageSize: 30 };
}
export async function recordDeparture(input: z.infer<typeof departureSchema>, actor: Actor) {
  manager(actor); const departedAt = assertPast(input.departedAt), returnedAt = assertPast(input.returnedAt);
  const requestHash = createHash("sha256").update(JSON.stringify({ ...input, userIds: [...input.userIds].sort() })).digest("hex");
  return serializable(async (tx) => {
    const previous = await tx.vehicleDeparture.findUnique({ where: { operationKey: input.operationKey } });
    if (previous) {
      if (previous.createdByUserId !== actor.userId || previous.requestHash !== requestHash) throw new OperationError(409, "Clave de operacion utilizada para otra salida");
      return { id: previous.id, replayed: true };
    }
    const asset = await tx.asset.findFirst({ where: { id: input.assetId, assetType: "VEHICLE", deletedAt: null, vehicle: { isNot: null } }, select: { id: true, name: true } });
    if (!asset) throw new OperationError(400, "Seleccione un movil vigente");
    await activePeople(tx, input.userIds);
    if(await tx.missionMovement.findFirst({where:{departedAt:{lt:returnedAt},OR:[{returnedAt:null},{returnedAt:{gt:departedAt}}],AND:[{OR:[{assetId:input.assetId},{crew:{some:{userId:{in:input.userIds}}}}]}]}}))throw new OperationError(409,"La salida se superpone con un despliegue de emergencia registrado");
    if (await tx.vehicleDeparture.findFirst({ where: { voidedAt: null, departedAt: { lt: returnedAt }, returnedAt: { gt: departedAt }, OR: [{ assetId: input.assetId }, { crew: { some: { userId: { in: input.userIds } } } }] } })) throw new OperationError(409, "El movil o algun integrante tiene otra salida en ese horario");
    const row = await tx.vehicleDeparture.create({ data: { operationKey: input.operationKey, requestHash, assetId: input.assetId, departedAt, returnedAt, purpose: input.purpose, notes: input.notes, createdByUserId: actor.userId, crew: { create: input.userIds.map((userId) => ({ userId, isLeader: userId === input.leaderUserId })) } } });
    await tx.auditLog.create({ data: { actorUserId: actor.userId, action: "VEHICLE_DEPARTURE_RECORDED", entityType: "VehicleDeparture", entityId: row.id, metadata: { userIds: input.userIds, departedAt: departedAt.toISOString(), returnedAt: returnedAt.toISOString() } } });
    await notify(tx, input.userIds, `Salida registrada: ${asset.name}`, "/departures", "Las horas se agregan sin duplicar intervalos de guardias o permanencia. La permanencia en cuartel no fue cerrada.");
    return { id: row.id, replayed: false };
  });
}
export async function voidDeparture(id: string, revision: number, reason: string, actor: Actor) {
  manager(actor);
  return serializable(async (tx) => {
    if (!(await tx.vehicleDeparture.updateMany({ where: { id, revision, voidedAt: null }, data: { voidedAt: new Date(), voidReason: reason, revision: { increment: 1 } } })).count) throw new OperationError(409, "La salida cambio o ya fue anulada");
    await tx.auditLog.create({ data: { actorUserId: actor.userId, action: "VEHICLE_DEPARTURE_VOIDED", entityType: "VehicleDeparture", entityId: id, metadata: { reason } } });
    const members = await tx.departureMember.findMany({ where: { departureId: id }, select: { userId: true } });
    await notify(tx, members.map((m) => m.userId), "Acta de salida anulada", "/departures", reason);
    return { message: "Acta anulada; se conserva el historial y no se acreditan sus horas" };
  });
}
