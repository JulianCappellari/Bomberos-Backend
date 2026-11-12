import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../config/prisma";
import { serializable } from "../../utils/transaction";
import { lockRow } from "../../utils/database-schema";
import { stationDate } from "../../utils/station-time";
import { gpsSuspicionReasons, recordGpsSuspicion } from "../../utils/gps-suspicion";
import { OperationError } from "../operations/operations.schemas";
import { commandUserIds } from "../members/notifications.service";
import { getDistanceMeters } from "./attendance.utils";

// Cerrar la permanencia sin QR (cuando la persona ya se fue). Regla de seguridad: cerrar a distancia
// nunca puede sumar horas no verificadas. Se acredita hasta la ultima presencia verificada (QR de ingreso,
// confirmacion por GPS o vuelta de una salida) mas un margen igual al intervalo de los avisos de presencia.
// Si el GPS confirma que la persona sigue en el cuartel, se cierra en el momento, como con el QR.
export const REMOTE_GRACE_MINUTES = 30;
const REPEAT_ALERT_EVERY = 3;
// Cerrar a distancia mucho despues de la ultima presencia verificada queda marcado como tardio (confianza baja) y se avisa a jefatura.
export const LATE_CLOSE_HOURS = 2;

export const remoteCloseSchema = z.object({
  leftAt: z.string().datetime({ offset: true }).optional(),
  reason: z.string().trim().max(300).optional(),
  // La huella del dispositivo incluye el user agent completo (en iPhone supera los 200 caracteres).
  deviceFingerprint: z.string().min(1).max(2000).optional(),
  latitude: z.number().finite().min(-90).max(90).optional(),
  longitude: z.number().finite().min(-180).max(180).optional(),
  accuracy: z.number().finite().min(0).max(5000).optional(),
}).strict().refine((v) => (v.latitude === undefined) === (v.longitude === undefined), "Ubicación incompleta");

type OpenRow = { id: string; checkInAt: Date | null; lastPresenceConfirmedAt: Date | null; presenceResumeAt: Date | null; station: { latitude: number; longitude: number; radiusMeters: number; requiresLocation: boolean; name: string } };

function verifiedUntil(row: OpenRow) {
  return [row.checkInAt, row.lastPresenceConfirmedAt, row.presenceResumeAt].filter((d): d is Date => Boolean(d)).sort((a, b) => +b - +a)[0] ?? new Date();
}
function capFor(row: OpenRow, now: Date) {
  // Misma regla en todas las bases: en la base sin ubicacion la presencia se confirma tocando el aviso cada 30 minutos.
  const cap = new Date(+verifiedUntil(row) + REMOTE_GRACE_MINUTES * 60000);
  return cap < now ? cap : now;
}

async function findOpen(tx: Prisma.TransactionClient, userId: string) {
  return tx.attendance.findFirst({ where: { userId, status: "OPEN", discardedAt: null }, orderBy: { createdAt: "desc" }, select: { id: true, checkInAt: true, lastPresenceConfirmedAt: true, presenceResumeAt: true, station: { select: { latitude: true, longitude: true, radiusMeters: true, requiresLocation: true, name: true } } } });
}

/** Lo que se acreditaria al cerrar ahora a distancia (para mostrarlo antes de confirmar). */
export async function remoteClosePreview(userId: string) {
  const row = await findOpen(prisma, userId);
  if (!row) return { open: false as const };
  const now = new Date();
  const onMission = Boolean(await prisma.missionCrew.findFirst({ where: { userId, movement: { returnedAt: null } }, select: { movementId: true } }));
  return { open: true as const, attendanceId: row.id, station: row.station.name, requiresLocation: row.station.requiresLocation, checkInAt: row.checkInAt, verifiedUntil: verifiedUntil(row), creditedUntil: capFor(row, now), graceMinutes: REMOTE_GRACE_MINUTES, late: +now - +verifiedUntil(row) > LATE_CLOSE_HOURS * 3_600_000, lateHours: LATE_CLOSE_HOURS, now, onMission };
}

export async function closeRemotely(actor: { userId: string; role: string }, input: z.infer<typeof remoteCloseSchema>) {
  if (actor.role === "GUARD") throw new OperationError(403, "La cuenta de guardia no registra asistencia");
  return serializable(async (tx) => {
    const row = await findOpen(tx, actor.userId);
    if (!row?.checkInAt) throw new OperationError(404, "No tenés una permanencia abierta");
    await lockRow(tx, "Attendance", row.id);
    if (await tx.missionCrew.findFirst({ where: { userId: actor.userId, movement: { returnedAt: null } } })) throw new OperationError(409, "Estás integrando una salida: tu permanencia se retoma al volver al cuartel");
    const now = new Date();
    // ¿El GPS confirma que todavia esta en el cuartel? Entonces vale como presencia verificada ahora.
    let gpsInside = false, distance: number | null = null;
    if (row.station.requiresLocation && typeof input.latitude === "number" && typeof input.longitude === "number") {
      distance = Math.round(getDistanceMeters(input.latitude, input.longitude, row.station.latitude, row.station.longitude));
      gpsInside = (input.accuracy ?? 999) <= 100 && distance + (input.accuracy ?? 0) <= Math.max(row.station.radiusMeters, 100);
    }
    const cap = gpsInside ? now : capFor(row, now);
    const requested = input.leftAt ? new Date(input.leftAt) : null;
    if (requested && requested > new Date(+now + 60000)) throw new OperationError(400, "La hora de salida no puede ser futura");
    if (requested && requested < row.checkInAt) throw new OperationError(400, "La hora de salida no puede ser anterior a tu ingreso");
    const credited = requested && requested < cap ? requested : cap;
    const capped = Boolean(requested && requested > cap) || (!requested && !gpsInside && cap < now);
    const late = !gpsInside && +now - +verifiedUntil(row) > LATE_CLOSE_HOURS * 3_600_000;
    const method = gpsInside ? "REMOTE_GPS" : late ? "REMOTE_LATE" : "REMOTE";
    const workedMinutes = Math.max(0, Math.floor((+credited - +row.checkInAt) / 60000));
    await tx.attendance.update({ where: { id: row.id }, data: {
      status: "CLOSED", checkOutAt: credited, workedMinutes, checkOutTrust: "MEDIUM", checkOutMethod: method,
      checkOutDevice: input.deviceFingerprint ?? null, checkOutLatitude: input.latitude ?? null, checkOutLongitude: input.longitude ?? null, checkOutAccuracy: input.accuracy ?? null,
    } });
    await tx.attendanceRecord.create({ data: { userId: actor.userId, type: "EXIT", method: "MANUAL", notes: gpsInside ? `Salida sin QR confirmada por GPS en ${row.station.name}` : `Salida cerrada a distancia${input.reason ? `: ${input.reason}` : ""}` } });
    await tx.auditLog.create({ data: { actorUserId: actor.userId, action: "ATTENDANCE_CLOSED_REMOTELY", entityType: "Attendance", entityId: row.id, metadata: {
      method, creditedUntil: credited.toISOString(), requestedLeftAt: requested?.toISOString() ?? null, verifiedUntil: verifiedUntil(row).toISOString(), capped, gpsInside, distanceMeters: distance, reason: input.reason ?? null, late, recordedAt: now.toISOString(),
    } } });
    if (typeof input.latitude === "number" && typeof input.longitude === "number") await recordGpsSuspicion(tx, actor.userId, row.id, "Cierre de permanencia sin QR", gpsSuspicionReasons({ latitude: input.latitude, longitude: input.longitude, accuracy: input.accuracy }));
    // Aviso a jefatura cuando alguien cierra a distancia de forma repetida (3, 6, 9… en el mes).
    const month = stationDate().slice(0, 7);
    const count = await tx.attendance.count({ where: { userId: actor.userId, checkOutMethod: { in: ["REMOTE", "REMOTE_GPS", "REMOTE_LATE"] }, checkOutAt: { gte: new Date(`${month}-01T03:00:00Z`) } } });
    const person = await tx.user.findUnique({ where: { id: actor.userId }, select: { username: true, profile: { select: { fullName: true } } } });
    const name = person?.profile?.fullName || person?.username;
    if (late) {
      const recipients = await commandUserIds(tx, actor.userId);
      const hours = Math.floor((+now - +verifiedUntil(row)) / 3_600_000);
      await tx.memberNotification.createMany({ data: recipients.map((userId) => ({ userId, dedupeKey: `remote-close-late:${row.id}:${userId}`, title: `Cierre de asistencia tardío: ${name}`, href: "/reports", body: `Cerró su permanencia sin QR ${hours} h después de su última presencia verificada. Se acreditó solo hasta las ${credited.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Argentina/Buenos_Aires" })}.` })), skipDuplicates: true });
    }
    if (count >= REPEAT_ALERT_EVERY && count % REPEAT_ALERT_EVERY === 0) {
      const recipients = (await commandUserIds(tx, actor.userId));
      await tx.memberNotification.createMany({ data: recipients.map((userId) => ({ userId, dedupeKey: `remote-close:${actor.userId}:${month}:${count}:${userId}`, title: `Cierres de asistencia sin QR: ${name}`, href: "/reports", body: `Lleva ${count} cierres a distancia este mes. Se acredita solo hasta la última presencia verificada; conviene recordarle escanear el QR al irse.` })), skipDuplicates: true });
    }
    return { attendanceId: row.id, method, creditedUntil: credited, workedMinutes, capped, gpsInside, late, remoteClosesThisMonth: count };
  });
}
