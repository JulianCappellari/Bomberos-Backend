import { z } from "zod";
import { prisma } from "../../config/prisma";
import { serializable } from "../../utils/transaction";
import { OperationError } from "../operations/operations.schemas";
import { getDistanceMeters } from "../attendance/attendance.utils";
import { Prisma } from "@prisma/client";
import { shiftInterval } from "../shifts/shifts.rules";
import { guardPresenceUntil } from "./presence-policy";
import { stationDate } from "../../utils/station-time";
import { notify } from "./notifications.service";
import { gpsSuspicionReasons, recordGpsSuspicion } from "../../utils/gps-suspicion";
const GRACE = 15 * 60000;
function windowTimes(shown: Date) {
  return { retryAt: new Date(+shown + GRACE), expiresAt: new Date(+shown + 2 * GRACE) };
}
export const presenceSchema = z.discriminatedUnion("inside", [
  z.object({ attendanceId: z.string().min(1), inside: z.literal(false) }).strict(),
  z.object({ attendanceId: z.string().min(1), inside: z.literal(true), latitude: z.number().finite().min(-90).max(90), longitude: z.number().finite().min(-180).max(180), accuracy: z.number().finite().min(0).max(50), capturedAt: z.string().datetime({ offset: true }) }).strict(),
]);
export function presenceDueAt(row: { checkInAt: Date | null; lastPresenceConfirmedAt?: Date | null; presenceResumeAt?: Date | null }) {
  const base = [row.checkInAt, row.lastPresenceConfirmedAt, row.presenceResumeAt].filter((date): date is Date => Boolean(date)).sort((a,b)=>b.getTime()-a.getTime())[0];
  return base ? new Date(base.getTime() + 30 * 60000) : null;
}
async function effectivePresenceDue(tx: Prisma.TransactionClient, userId: string, row: { checkInAt: Date | null; lastPresenceConfirmedAt?: Date | null; presenceResumeAt?: Date | null }) {
  const ordinary = presenceDueAt(row);
  if (!row.checkInAt || !ordinary) return { dueAt: ordinary, guardUntil: null };
  const first = new Date(stationDate(new Date(row.checkInAt.getTime() - 86400000)));
  const shifts = await tx.shift.findMany({ where: { date: { gte: first }, assignments: { some: { userId } } }, orderBy: { date: "asc" }, take: 100, select: { date: true, startTime: true, endTime: true, period: true } });
  const base = [row.checkInAt, row.lastPresenceConfirmedAt, row.presenceResumeAt].filter((date): date is Date => Boolean(date)).sort((a,b)=>b.getTime()-a.getTime())[0]!;
  const until = guardPresenceUntil(base, shifts.map(s => shiftInterval(s.date.toISOString().slice(0,10), s.period === "DAY" ? "08:00" : s.period === "NIGHT" ? "20:00" : s.startTime, s.period === "DAY" ? "20:00" : s.period === "NIGHT" ? "08:00" : s.endTime)));
  return { dueAt: until && until > ordinary ? until : ordinary, guardUntil: until };
}
export function assertPresenceLocation(input: { latitude: number; longitude: number; accuracy: number; capturedAt: string }, station: { latitude: number; longitude: number }, now = new Date()) {
  const age = now.getTime() - new Date(input.capturedAt).getTime();
  if (!Number.isFinite(age) || age < -5000 || age > 60000) throw new OperationError(400, "Solicite una ubicacion reciente");
  const distance = getDistanceMeters(input.latitude, input.longitude, station.latitude, station.longitude);
  if (input.accuracy > 50 || distance + input.accuracy > 100) throw new OperationError(400, "La ubicacion no permite confirmar presencia dentro de los 100 metros de la base");
  return distance;
}
export async function presenceState(userId: string) {
  return prisma.$transaction(async tx => {
  const row = await tx.attendance.findFirst({ where: { userId, status: "OPEN", checkInQrId: { not: null }, checkInAt: { lte: new Date() }, checkInTrust: { not: "REJECTED" } }, orderBy: { checkInAt: "desc" }, select: { id: true, checkInAt: true, lastPresenceConfirmedAt: true, presenceResumeAt: true, promptShownAt: true, promptDueAt: true, station: { select: { name: true, requiresLocation: true } } } });
  if (!row) return { attendance: null, dueAt: null, needsConfirmation: false };
  // La base sin ubicacion no pide confirmar presencia con GPS.
  if (!row.station.requiresLocation) return { attendance: { id: row.id, stationName: row.station.name }, dueAt: null, needsConfirmation: false };
  const mission = await tx.missionCrew.findFirst({where:{userId,movement:{returnedAt:null}},select:{movementId:true}});
  if(mission)return {attendance:{id:row.id,stationName:row.station.name},dueAt:null,needsConfirmation:false,suspendedForMission:mission.movementId};
  const { dueAt, guardUntil } = await effectivePresenceDue(tx, userId, row);
  return { attendance: { id: row.id, stationName: row.station.name }, dueAt, guardUntil, needsConfirmation: Boolean(dueAt && dueAt <= new Date()), ...(row.promptShownAt && row.promptDueAt?.getTime() === dueAt?.getTime() ? windowTimes(row.promptShownAt) : {}) };
  }, { isolationLevel: "RepeatableRead" });
}
export async function markPromptShown(userId: string, attendanceId: string, expectedDue: string) {
  return serializable(async tx => {
    const row = await tx.attendance.findFirst({where:{id:attendanceId,userId,status:"OPEN",checkInQrId:{not:null},checkInTrust:{not:"REJECTED"}}});
    if (!row || await tx.missionCrew.findFirst({where:{userId,movement:{returnedAt:null}}})) throw new OperationError(409,"La verificación ya no está pendiente");
    const {dueAt} = await effectivePresenceDue(tx,userId,row), now = new Date();
    if (!dueAt || dueAt > now || +dueAt !== Date.parse(expectedDue)) throw new OperationError(409,"La verificación cambió");
    if (row.promptShownAt && row.promptDueAt?.getTime() === +dueAt) return windowTimes(row.promptShownAt);
    await tx.attendance.update({where:{id:row.id},data:{promptShownAt:now,promptDueAt:dueAt}});
    return windowTimes(now);
  });
}

export async function expirePresence(id: string, now = new Date()) {
  return serializable(async tx => {
    const row = await tx.attendance.findFirst({where:{id,status:"OPEN",checkInQrId:{not:null},checkInTrust:{not:"REJECTED"}}});
    if (!row?.checkInAt || !row.promptShownAt || !row.promptDueAt) return false;
    const {expiresAt} = windowTimes(row.promptShownAt);
    if (now < expiresAt) return false;
    const {dueAt} = await effectivePresenceDue(tx,row.userId,row);
    if (dueAt?.getTime() !== +row.promptDueAt || await tx.missionCrew.findFirst({where:{userId:row.userId,movement:{returnedAt:null}}})) {
      await tx.attendance.update({where:{id},data:{promptDueAt:null,promptShownAt:null}});
      return false;
    }
    await tx.attendance.update({where:{id},data:{status:"CLOSED",checkOutAt:expiresAt,checkOutTrust:null,workedMinutes:Math.max(0,Math.floor((+expiresAt - +row.checkInAt)/60000)),discardedAt:expiresAt,discardReason:"Cierre automatico sin revalidacion"}});
    await tx.auditLog.create({data:{action:"SYSTEM_PRESENCE_TIMED_OUT",entityType:"Attendance",entityId:id,metadata:{userId:row.userId,shownAt:row.promptShownAt.toISOString(),closedAt:expiresAt.toISOString(),reason:"Sin confirmación válida en el plazo",discarded:true}}});
    await notify(tx,[row.userId],"Permanencia cerrada por falta de confirmación","/attendance","La permanencia completa quedó descartada: no suma horas ni puntos. Para volver a ingresar, escanee el QR.");
    return true;
  });
}
export async function confirmPresence(input: z.infer<typeof presenceSchema>, userId: string) {
  return serializable(async (tx) => {
    const row = await tx.attendance.findFirst({ where: { id: input.attendanceId, userId, status: "OPEN" }, include: { station: true } });
    if (!row || !row.checkInAt) throw new OperationError(409, "La permanencia ya termino o cambio");
    if(await tx.missionCrew.findFirst({where:{userId,movement:{returnedAt:null}}}))throw new OperationError(409,"La verificacion permanece suspendida durante la salida a intervencion");
    const now = new Date();
    if (row.promptShownAt && now >= windowTimes(row.promptShownAt).expiresAt) {
      const { dueAt } = await effectivePresenceDue(tx,userId,row);
      if (dueAt && row.promptDueAt?.getTime() === +dueAt) throw new OperationError(409,"El plazo venció; el contador se cerrará automáticamente");
    }
    if (input.inside && !row.checkInQrId) throw new OperationError(409, "Esta permanencia no proviene de un ingreso QR");
    if (!input.inside) {
      const changed = await tx.attendance.updateMany({ where: { id: row.id, status: "OPEN", userId }, data: { status: "CLOSED", checkOutAt: now, workedMinutes: Math.max(0, Math.floor((now.getTime() - row.checkInAt.getTime()) / 60000)), checkOutTrust: "MEDIUM" } });
      if (!changed.count) throw new OperationError(409, "La permanencia ya se cerro");
    } else {
      const { dueAt } = await effectivePresenceDue(tx, userId, row);
      if (!dueAt) throw new OperationError(409, "Permanencia sin hora de ingreso valida");
      if (dueAt > now) throw new OperationError(409, "La presencia ya fue confirmada recientemente");
      assertPresenceLocation(input, row.station, now);
      await recordGpsSuspicion(tx, userId, row.id, "Revalidación de presencia", gpsSuspicionReasons(input, { latitude: row.checkInLatitude, longitude: row.checkInLongitude }));
      await tx.attendance.update({ where: { id: row.id }, data: { lastPresenceConfirmedAt: now, promptShownAt:null, promptDueAt:null } });
    }
    await tx.auditLog.create({ data: { actorUserId: userId, action: input.inside ? "PRESENCE_CONFIRMED" : "PRESENCE_EXIT_DECLARED", entityType: "Attendance", entityId: row.id } });
    return { message: input.inside ? "Presencia confirmada por 30 minutos" : "Permanencia cerrada" };
  });
}
