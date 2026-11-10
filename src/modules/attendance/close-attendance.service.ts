import { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma";
import { serializable } from "../../utils/transaction";
import { PUBLIC_USER_SELECT } from "../../utils/public-user";
import { normalizeRank } from "../../utils/firefighter-ranks";
import { OperationError } from "../operations/operations.schemas";
import { notify, notifyCommand } from "../members/notifications.service";

type Actor = { userId: string; role: string; rank?: string | null };
const DUTY = ["ADMIN", "OPERATOR", "GUARD"];
const isTechnicalAdmin = (actor: Actor) => actor.role === "ADMIN" && normalizeRank(actor.rank) === "administrador";
const include = { attendance: { select: { id: true, userId: true, status: true, checkInAt: true, checkOutAt: true, user: { select: PUBLIC_USER_SELECT }, station: { select: { name: true } } } }, requestedBy: { select: PUBLIC_USER_SELECT }, decidedBy: { select: PUBLIC_USER_SELECT } } as const;

async function applyClose(tx: Prisma.TransactionClient, id: string, at: Date) {
  const row = await tx.attendance.findFirst({ where: { id, status: "OPEN" } });
  if (!row?.checkInAt) throw new OperationError(409, "La permanencia no esta abierta");
  if (row.checkInAt > at) throw new OperationError(400, "La hora de cierre es anterior al ingreso; requiere revision administrativa");
  const result = await tx.attendance.updateMany({ where: { id, status: "OPEN" }, data: { status: "CLOSED", checkOutAt: at, checkOutTrust: "MEDIUM", promptShownAt: null, promptDueAt: null, workedMinutes: Math.max(0, Math.floor((at.getTime() - row.checkInAt.getTime()) / 60000)) } });
  if (!result.count) throw new OperationError(409, "La permanencia ya fue cerrada");
  return row;
}

// E10: Guardia y jefatura no corrigen por si solos un fichaje ajeno; el cierre queda pendiente de una
// segunda autorizacion independiente. E15: el administrador tecnico resuelve directamente las
// permanencias que quedaron abiertas por una falla del sistema.
export async function closeAttendance(id: string, reason: string, actor: Actor) {
  if (!DUTY.includes(actor.role)) throw new OperationError(403, "No puede cerrar asistencias ajenas");
  return serializable(async (tx) => {
    const row = await tx.attendance.findFirst({ where: { id, status: "OPEN" } });
    if (!row?.checkInAt) throw new OperationError(409, "La permanencia no esta abierta");
    const now = new Date();
    if (row.checkInAt > now) throw new OperationError(400, "La fecha de ingreso es futura; requiere revision administrativa");
    if (isTechnicalAdmin(actor)) {
      await applyClose(tx, id, now);
      await tx.auditLog.create({ data: { actorUserId: actor.userId, action: "ATTENDANCE_CLOSED_BY_ADMIN", entityType: "Attendance", entityId: id, metadata: { userId: row.userId, reason, before: { status: row.status }, after: { status: "CLOSED", checkOutAt: now.toISOString() } } } });
      await notify(tx, [row.userId], "Su permanencia fue cerrada por administración", "/attendance", reason);
      return { pending: false, message: "Permanencia cerrada; registro conservado" };
    }
    if (row.userId === actor.userId) throw new OperationError(403, "Para cerrar su propia permanencia registre la salida con el QR");
    const existing = await tx.attendanceCorrection.findFirst({ where: { attendanceId: id, status: "PENDING" } });
    if (existing) return { pending: true, correctionId: existing.id, message: "Ya existe un cierre pendiente de segunda autorización" };
    const correction = await tx.attendanceCorrection.create({ data: { attendanceId: id, action: "CLOSE", effectiveAt: now, reason, requestedByUserId: actor.userId } });
    await tx.auditLog.create({ data: { actorUserId: actor.userId, action: "ATTENDANCE_CORRECTION_REQUESTED", entityType: "Attendance", entityId: id, metadata: { correctionId: correction.id, action: "CLOSE", userId: row.userId, effectiveAt: now.toISOString(), reason } } });
    await notifyCommand(tx, "Cierre de fichaje ajeno: requiere segunda autorización", "/attendance", reason, actor.userId);
    return { pending: true, correctionId: correction.id, message: "Cierre solicitado. Se aplicará con la hora de este pedido cuando otra persona de jefatura lo autorice" };
  });
}

// E09/E10: si el GPS falla estando realmente en la base, la apertura manual exige doble autorizacion.
export async function requestOpenAttendance(input: { userId: string; stationId: string; effectiveAt: string; reason: string }, actor: Actor) {
  if (!DUTY.includes(actor.role)) throw new OperationError(403, "Solo guardia o jefatura solicitan una apertura manual");
  if (input.userId === actor.userId) throw new OperationError(403, "No puede solicitar la apertura de su propia permanencia");
  const effectiveAt = new Date(input.effectiveAt), now = new Date();
  if (effectiveAt > now || now.getTime() - effectiveAt.getTime() > 12 * 3600000) throw new OperationError(400, "La hora de ingreso debe estar dentro de las últimas 12 horas");
  return serializable(async (tx) => {
    const person = await tx.user.findFirst({ where: { id: input.userId, isActive: true, isPendingApproval: false, deletedAt: null }, include: { profile: true } });
    if (!person || normalizeRank(person.profile?.rank) === "administrador") throw new OperationError(400, "Seleccione personal operativo activo");
    if (!await tx.station.findUnique({ where: { id: input.stationId }, select: { id: true } })) throw new OperationError(400, "Base no encontrada");
    if (await tx.attendance.findFirst({ where: { userId: input.userId, status: "OPEN" }, select: { id: true } })) throw new OperationError(409, "La persona ya tiene una permanencia abierta");
    if (await tx.attendance.findFirst({ where: { userId: input.userId, checkInAt: { lte: now }, checkOutAt: { gt: effectiveAt } }, select: { id: true } })) throw new OperationError(409, "La hora indicada se superpone con otra permanencia registrada");
    // La permanencia se crea rechazada (no acredita nada) y solo se habilita con la segunda autorizacion.
    const attendance = await tx.attendance.create({ data: { userId: input.userId, stationId: input.stationId, status: "CLOSED", checkInAt: effectiveAt, checkOutAt: effectiveAt, workedMinutes: 0, checkInTrust: "REJECTED", checkInDevice: "APERTURA_MANUAL_PENDIENTE" } });
    const correction = await tx.attendanceCorrection.create({ data: { attendanceId: attendance.id, action: "OPEN", effectiveAt, reason: input.reason, requestedByUserId: actor.userId } });
    await tx.auditLog.create({ data: { actorUserId: actor.userId, action: "ATTENDANCE_CORRECTION_REQUESTED", entityType: "Attendance", entityId: attendance.id, metadata: { correctionId: correction.id, action: "OPEN", userId: input.userId, effectiveAt: effectiveAt.toISOString(), reason: input.reason } } });
    await notifyCommand(tx, "Apertura manual de fichaje: requiere segunda autorización", "/attendance", input.reason, actor.userId);
    return { pending: true, correctionId: correction.id, message: "Apertura solicitada. La permanencia rige cuando otra persona de jefatura la autorice" };
  });
}

export async function listCorrections(status: "PENDING" | "ALL", actor: Actor) {
  if (!DUTY.includes(actor.role)) throw new OperationError(403, "Acceso reservado a guardia y jefatura");
  return prisma.attendanceCorrection.findMany({ where: status === "PENDING" ? { status: "PENDING" } : {}, include, orderBy: [{ createdAt: "desc" }, { id: "asc" }], take: 100 });
}

export async function decideCorrection(id: string, input: { approve: boolean; note: string }, actor: Actor) {
  if (!["ADMIN", "OPERATOR"].includes(actor.role)) throw new OperationError(403, "La segunda autorización corresponde a jefatura o administración");
  return serializable(async (tx) => {
    const correction = await tx.attendanceCorrection.findUnique({ where: { id }, include: { attendance: true } });
    if (!correction || correction.status !== "PENDING") throw new OperationError(409, "La corrección ya fue resuelta");
    // T03: quien autoriza no puede ser quien solicito ni la persona beneficiada.
    if (correction.requestedByUserId === actor.userId || correction.attendance.userId === actor.userId) throw new OperationError(403, "La segunda autorización debe darla una persona distinta del solicitante y del titular");
    const now = new Date();
    if (input.approve && correction.action === "CLOSE") {
      if (correction.attendance.status === "OPEN") await applyClose(tx, correction.attendanceId, correction.effectiveAt);
    } else if (input.approve) {
      if (await tx.attendance.findFirst({ where: { userId: correction.attendance.userId, status: "OPEN" }, select: { id: true } })) throw new OperationError(409, "La persona ya tiene otra permanencia abierta");
      await tx.attendance.update({ where: { id: correction.attendanceId }, data: { status: "OPEN", checkOutAt: null, workedMinutes: null, checkInTrust: "MEDIUM", checkInQrId: `manual:${correction.id}`, checkInDevice: "APERTURA_MANUAL_DOBLE_AUTORIZACION", lastPresenceConfirmedAt: now } });
    }
    await tx.attendanceCorrection.update({ where: { id }, data: { status: input.approve ? "APPROVED" : "REJECTED", decidedByUserId: actor.userId, decisionNote: input.note, decidedAt: now } });
    await tx.auditLog.create({ data: { actorUserId: actor.userId, action: input.approve ? "ATTENDANCE_CORRECTION_APPROVED" : "ATTENDANCE_CORRECTION_REJECTED", entityType: "Attendance", entityId: correction.attendanceId, metadata: { correctionId: id, action: correction.action, userId: correction.attendance.userId, requestedByUserId: correction.requestedByUserId, effectiveAt: correction.effectiveAt.toISOString(), note: input.note } } });
    await notify(tx, [correction.requestedByUserId, correction.attendance.userId], `Corrección de fichaje ${input.approve ? "autorizada" : "rechazada"}`, "/attendance", input.note);
    return { status: input.approve ? "APPROVED" : "REJECTED" };
  });
}
