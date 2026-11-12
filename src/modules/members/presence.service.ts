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
// La ventana para confirmar corre desde el vencimiento (cuando se manda el aviso al celular), se vea o no en pantalla:
// a los 15 minutos la app reintenta con GPS y a los 30 la permanencia se cierra sola.
export function windowTimes(due: Date) {
  return { retryAt: new Date(+due + GRACE), expiresAt: new Date(+due + 2 * GRACE) };
}
export const presenceSchema = z.union([
  z.object({ attendanceId: z.string().min(1), inside: z.literal(false) }).strict(),
  // Base sin ubicacion: se confirma tocando el aviso (no hay GPS que comparar).
  z.object({ attendanceId: z.string().min(1), inside: z.literal(true), tap: z.literal(true) }).strict(),
  z.object({ attendanceId: z.string().min(1), inside: z.literal(true), latitude: z.number().finite().min(-90).max(90), longitude: z.number().finite().min(-180).max(180), accuracy: z.number().finite().min(0).max(50), capturedAt: z.string().datetime({ offset: true }) }).strict(),
]);
export function presenceDueAt(row: { checkInAt: Date | null; lastPresenceConfirmedAt?: Date | null; presenceResumeAt?: Date | null }) {
  const base = [row.checkInAt, row.lastPresenceConfirmedAt, row.presenceResumeAt].filter((date): date is Date => Boolean(date)).sort((a,b)=>b.getTime()-a.getTime())[0];
  return base ? new Date(base.getTime() + 30 * 60000) : null;
}
export async function effectivePresenceDue(tx: Prisma.TransactionClient, userId: string, row: { checkInAt: Date | null; lastPresenceConfirmedAt?: Date | null; presenceResumeAt?: Date | null }) {
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
  // La base sin ubicacion tambien pide confirmar presencia cada 30 minutos, tocando el aviso (sin GPS).
  const requiresLocation = row.station.requiresLocation;
  const mission = await tx.missionCrew.findFirst({where:{userId,movement:{returnedAt:null}},select:{movementId:true}});
  if(mission)return {attendance:{id:row.id,stationName:row.station.name,requiresLocation},dueAt:null,needsConfirmation:false,suspendedForMission:mission.movementId};
  const { dueAt, guardUntil } = await effectivePresenceDue(tx, userId, row);
  return { attendance: { id: row.id, stationName: row.station.name, requiresLocation }, dueAt, guardUntil, needsConfirmation: Boolean(dueAt && dueAt <= new Date()), ...(dueAt && dueAt <= new Date() ? windowTimes(dueAt) : {}) };
  }, { isolationLevel: "RepeatableRead" });
}
export async function markPromptShown(userId: string, attendanceId: string, expectedDue: string) {
  return serializable(async tx => {
    const row = await tx.attendance.findFirst({where:{id:attendanceId,userId,status:"OPEN",checkInQrId:{not:null},checkInTrust:{not:"REJECTED"}}});
    if (!row || await tx.missionCrew.findFirst({where:{userId,movement:{returnedAt:null}}})) throw new OperationError(409,"La verificación ya no está pendiente");
    const {dueAt} = await effectivePresenceDue(tx,userId,row), now = new Date();
    if (!dueAt || dueAt > now || +dueAt !== Date.parse(expectedDue)) throw new OperationError(409,"La verificación cambió");
    // Solo queda registrado cuando se vio el aviso; el plazo corre igual desde el vencimiento.
    if (!(row.promptShownAt && row.promptDueAt?.getTime() === +dueAt)) await tx.attendance.update({where:{id:row.id},data:{promptShownAt:now,promptDueAt:dueAt}});
    return windowTimes(dueAt);
  });
}

export async function expirePresence(id: string, now = new Date()) {
  return serializable(async tx => {
    const row = await tx.attendance.findFirst({where:{id,status:"OPEN",checkInQrId:{not:null},checkInTrust:{not:"REJECTED"}},include:{station:{select:{name:true}}}});
    if (!row?.checkInAt) return false;
    // Durante una salida la verificacion queda suspendida (se retoma al volver).
    if (await tx.missionCrew.findFirst({where:{userId:row.userId,movement:{returnedAt:null}}})) return false;
    const {dueAt} = await effectivePresenceDue(tx,row.userId,row);
    if (!dueAt) return false;
    const {expiresAt} = windowTimes(dueAt);
    if (now < expiresAt) return false;
    // Se acredita hasta el vencimiento: ultima presencia verificada + 30 min (o el fin de la guardia asignada).
    const credited = dueAt < row.checkInAt ? row.checkInAt : dueAt;
    const workedMinutes = Math.max(0,Math.floor((+credited - +row.checkInAt)/60000));
    const changed = await tx.attendance.updateMany({where:{id,status:"OPEN"},data:{status:"CLOSED",checkOutAt:credited,checkOutTrust:"MEDIUM",checkOutMethod:"PRESENCE_TIMEOUT",workedMinutes,promptDueAt:null,promptShownAt:null}});
    if (!changed.count) return false;
    await tx.auditLog.create({data:{action:"SYSTEM_PRESENCE_TIMED_OUT",entityType:"Attendance",entityId:id,metadata:{userId:row.userId,dueAt:dueAt.toISOString(),closedAt:now.toISOString(),creditedUntil:credited.toISOString(),workedMinutes,discarded:false,reason:"Sin confirmación de presencia en 30 minutos: se acredita solo lo verificado"}}});
    const until = credited.toLocaleTimeString("es-AR",{hour:"2-digit",minute:"2-digit",timeZone:"America/Argentina/Buenos_Aires"});
    await notify(tx,[row.userId],"Permanencia cerrada: no confirmaste tu presencia","/attendance",`Se acreditó hasta las ${until} (tu última presencia verificada). Si seguís en ${row.station.name}, escaneá el QR para volver a ingresar.`);
    return true;
  });
}

/** Aviso al celular cuando toca confirmar presencia (una vez por vencimiento). Devuelve cuantos avisos genero. */
export async function remindDuePresence(now = new Date()) {
  const rows = await prisma.attendance.findMany({ where: { status: "OPEN", checkInQrId: { not: null }, checkInAt: { lte: now }, checkInTrust: { not: "REJECTED" }, discardedAt: null }, select: { id: true, userId: true, checkInAt: true, lastPresenceConfirmedAt: true, presenceResumeAt: true, station: { select: { name: true, requiresLocation: true } } }, take: 500 });
  let sent = 0;
  for (const row of rows) {
    const created = await prisma.$transaction(async (tx) => {
      if (await tx.missionCrew.findFirst({ where: { userId: row.userId, movement: { returnedAt: null } }, select: { userId: true } })) return false;
      const { dueAt } = await effectivePresenceDue(tx, row.userId, row);
      // Solo vencimientos recientes: no se avisa de algo que vencio hace horas (ya se cerro o se cierra solo).
      if (!dueAt || dueAt > now || +now - +dueAt > 20 * 60000) return false;
      const result = await tx.memberNotification.createMany({ data: [{ userId: row.userId, dedupeKey: `presence:${row.id}:${dueAt.toISOString()}`, title: `¿Seguís en ${row.station.name}?`, href: "/dashboard", body: row.station.requiresLocation ? "Confirmá tu presencia con la ubicación. Si no confirmás, la permanencia se cierra y no suma horas." : "Tocá para confirmar que seguís en la base. Si no confirmás, la permanencia se cierra y no suma horas." }], skipDuplicates: true });
      return result.count > 0;
    }, { isolationLevel: "RepeatableRead" });
    if (created) sent++;
  }
  return sent;
}
export async function confirmPresence(input: z.infer<typeof presenceSchema>, userId: string) {
  return serializable(async (tx) => {
    const row = await tx.attendance.findFirst({ where: { id: input.attendanceId, userId, status: "OPEN" }, include: { station: true } });
    if (!row || !row.checkInAt) throw new OperationError(409, "La permanencia ya termino o cambio");
    if(await tx.missionCrew.findFirst({where:{userId,movement:{returnedAt:null}}}))throw new OperationError(409,"La verificacion permanece suspendida durante la salida a intervencion");
    const now = new Date();
    {
      const { dueAt } = await effectivePresenceDue(tx,userId,row);
      if (dueAt && now >= windowTimes(dueAt).expiresAt) throw new OperationError(409,"El plazo para confirmar venció: la permanencia se cierra con lo verificado. Si seguís en el cuartel, escaneá el QR");
    }
    if (input.inside && !row.checkInQrId) throw new OperationError(409, "Esta permanencia no proviene de un ingreso QR");
    if (!input.inside) {
      const changed = await tx.attendance.updateMany({ where: { id: row.id, status: "OPEN", userId }, data: { status: "CLOSED", checkOutAt: now, workedMinutes: Math.max(0, Math.floor((now.getTime() - row.checkInAt.getTime()) / 60000)), checkOutTrust: "MEDIUM" } });
      if (!changed.count) throw new OperationError(409, "La permanencia ya se cerro");
    } else {
      const { dueAt } = await effectivePresenceDue(tx, userId, row);
      if (!dueAt) throw new OperationError(409, "Permanencia sin hora de ingreso valida");
      if (dueAt > now) throw new OperationError(409, "La presencia ya fue confirmada recientemente");
      if ("tap" in input) {
        if (row.station.requiresLocation) throw new OperationError(400, "En esta base la presencia se confirma con la ubicación");
      } else {
        if (!row.station.requiresLocation) throw new OperationError(400, "En esta base la presencia se confirma tocando el aviso");
        assertPresenceLocation(input, row.station, now);
        await recordGpsSuspicion(tx, userId, row.id, "Revalidación de presencia", gpsSuspicionReasons(input, { latitude: row.checkInLatitude, longitude: row.checkInLongitude }));
      }
      await tx.attendance.update({ where: { id: row.id }, data: { lastPresenceConfirmedAt: now, promptShownAt:null, promptDueAt:null } });
    }
    await tx.auditLog.create({ data: { actorUserId: userId, action: input.inside ? "PRESENCE_CONFIRMED" : "PRESENCE_EXIT_DECLARED", entityType: "Attendance", entityId: row.id, ...(input.inside && "tap" in input ? { metadata: { method: "TAP", reason: "Base sin ubicación" } } : {}) } });
    return { message: input.inside ? "Presencia confirmada por 30 minutos" : "Permanencia cerrada" };
  });
}
