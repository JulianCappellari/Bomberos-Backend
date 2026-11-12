import { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma";
import { shiftsOverlap } from "./shifts.rules";
import { PUBLIC_USER_SELECT } from "../../utils/public-user";
import { serializable } from "../../utils/transaction";
import { OperationError } from "../operations/operations.schemas";
import { shiftInterval } from "./shifts.rules";
import { notify, notifyCommand } from "../members/notifications.service";
import { normalizeRank } from "../../utils/firefighter-ranks";
import { Orderable, sortByPerson } from "../../utils/people-order";

export const SHIFT_SCHEDULES = {
  DAY: { startTime: "08:00", endTime: "20:00", label: "Guardia diurna" },
  NIGHT: { startTime: "20:00", endTime: "08:00", label: "Guardia nocturna" },
} as const;

const include = {
  createdBy: { select: PUBLIC_USER_SELECT },
  assignments: { include: { user: { select: PUBLIC_USER_SELECT } } },
} as const;
const dateOnly = (value: string) => new Date(value + "T00:00:00Z");
type ShiftInput = {
  date: string; period: "DAY" | "NIGHT"; notes?: string | null; assignedUserIds?: string[];
};

async function validateAssignments(
  tx: Prisma.TransactionClient,
  data: { date: string; period: "DAY" | "NIGHT"; userIds: string[]; excludeShiftId?: string; keepUserIds?: string[] },
) {
  if (!data.userIds.length) throw new OperationError(400, "La guardia debe tener personal asignado");
  const users = await tx.user.findMany({
    where: { id: { in: data.userIds }, isActive: true, isPendingApproval: false, deletedAt: null },
    select: { id: true },
  });
  if (users.length !== data.userIds.length) throw new OperationError(400, "Hay integrantes no habilitados");
  const unavailable = await tx.personnelAvailability.findFirst({
    where: { date: dateOnly(data.date), period: data.period, userId: { in: data.userIds }, status: "UNAVAILABLE" },
    include: { user: { select: PUBLIC_USER_SELECT } },
  });
  if (unavailable) throw new OperationError(409,
    `${unavailable.user.profile?.fullName || unavailable.user.username} no esta disponible para ese turno`);
  // D07: una ausencia programada bloquea nuevas asignaciones de guardia que se superpongan.
  const window = shiftInterval(data.date, SHIFT_SCHEDULES[data.period].startTime, SHIFT_SCHEDULES[data.period].endTime);
  const absent = await tx.emergencyAvailability.findFirst({
    where: { userId: { in: data.userIds.filter((id) => !data.keepUserIds?.includes(id)) }, cancelledAt: null, startsAt: { lt: new Date(window.end) }, OR: [{ endsAt: null }, { endsAt: { gt: new Date(Math.max(window.start, Date.now())) } }] },
    include: { user: { select: PUBLIC_USER_SELECT } },
  });
  if (absent && window.end > Date.now()) throw new OperationError(409,
    `${absent.user.profile?.fullName || absent.user.username} declaró una ausencia que se superpone con ese turno`);
  const previous = dateOnly(data.date);
  previous.setUTCDate(previous.getUTCDate() - 1);
  const next = dateOnly(data.date);
  next.setUTCDate(next.getUTCDate() + 1);
  const shifts = await tx.shift.findMany({
    where: {
      date: { gte: previous, lte: next },
      ...(data.excludeShiftId ? { id: { not: data.excludeShiftId } } : {}),
      assignments: { some: { userId: { in: data.userIds } } },
    },
    include,
  });
  const schedule = SHIFT_SCHEDULES[data.period];
  for (const shift of shifts) {
    if (!shiftsOverlap({ date: data.date, ...schedule }, {
      date: shift.date.toISOString().slice(0, 10), startTime: shift.startTime, endTime: shift.endTime,
    })) continue;
    const person = shift.assignments.find((assignment) => data.userIds.includes(assignment.userId))!.user;
    throw new OperationError(409, `${person.profile?.fullName || person.username} ya tiene una guardia en ese horario`);
  }
}
async function ensurePeriodFree(tx: Prisma.TransactionClient, data: ShiftInput, exceptId?: string) {
  const existing = await tx.shift.findFirst({
    where: { date: dateOnly(data.date), period: data.period, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true },
  });
  if (existing) throw new OperationError(409, "Ya existe ese turno para la fecha seleccionada");
}
function fields(data: ShiftInput) {
  const schedule = SHIFT_SCHEDULES[data.period];
  return {
    date: dateOnly(data.date), period: data.period, startTime: schedule.startTime,
    endTime: schedule.endTime, shiftType: schedule.label, notes: data.notes?.trim() || null,
  };
}
export async function createShift(data: ShiftInput & { createdByUserId: string }) {
  return serializable(async (tx) => {
    const userIds = [...new Set(data.assignedUserIds || [])];
    await ensurePeriodFree(tx, data);
    await validateAssignments(tx, { ...data, userIds });
    const shift = await tx.shift.create({
      data: { ...fields(data), createdByUserId: data.createdByUserId, assignments: { create: userIds.map((userId) => ({ userId })) } },
      include,
    });
    await tx.auditLog.create({
      data: { actorUserId: data.createdByUserId, action: "SHIFT_CREATED", entityType: "Shift", entityId: shift.id,
        metadata: { date: data.date, period: data.period, assignedUserIds: userIds } },
    });
    await notify(tx, userIds.filter((id) => id !== data.createdByUserId), `Guardia asignada: ${data.date} (${SHIFT_SCHEDULES[data.period].label})`, "/calendar");
    return shift;
  });
}
// Integrantes de cada guardia en orden institucional (cargo, antiguedad, cursos).
const ordered = <T extends { assignments: Array<{ user: Orderable }> }>(shift: T) => ({ ...shift, assignments: sortByPerson(shift.assignments, (a) => a.user) });
export async function getAllShifts(filters?: { date?: string; from?: string; to?: string }) {
  const rows = await prisma.shift.findMany({
    where: filters?.date ? { date: dateOnly(filters.date) } : {
      date: { ...(filters?.from ? { gte: dateOnly(filters.from) } : {}), ...(filters?.to ? { lte: dateOnly(filters.to) } : {}) },
    },
    include, orderBy: [{ date: "asc" }, { startTime: "asc" }],
  });
  return rows.map(ordered);
}
export async function getShiftById(id: string) {
  const shift = await prisma.shift.findUnique({ where: { id }, include });
  if (!shift) throw new OperationError(404, "Guardia no encontrada");
  return ordered(shift);
}
export async function updateShift(id: string, data: ShiftInput, actorUserId: string) {
  return serializable(async (tx) => {
    const existing = await tx.shift.findUnique({ where: { id } });
    if (!existing) throw new OperationError(404, "Guardia no encontrada");
    const userIds = [...new Set(data.assignedUserIds || [])];
    const previousIds = (await tx.shiftAssignment.findMany({ where: { shiftId: id }, select: { userId: true } })).map((row) => row.userId);
    await ensurePeriodFree(tx, data, id);
    await validateAssignments(tx, { ...data, userIds, excludeShiftId: id, keepUserIds: previousIds });
    await tx.shift.update({ where: { id }, data: fields(data) });
    await tx.shiftSwapRequest.updateMany({ where: { shiftId: id, status: { in: ["PENDING", "ACCEPTED", "OPEN"] } }, data: { status: "CANCELLED", decidedAt: new Date(), decisionNote: "La guardia fue reprogramada por jefatura" } });
    // M02: toda reasignacion de jefatura se notifica a quienes entran y a quienes salen del turno.
    await notify(tx, userIds.filter((userId) => !previousIds.includes(userId) && userId !== actorUserId), `Guardia asignada: ${data.date} (${SHIFT_SCHEDULES[data.period].label})`, "/calendar");
    await notify(tx, previousIds.filter((userId) => !userIds.includes(userId) && userId !== actorUserId), `Fue relevado de la guardia del ${data.date} (${SHIFT_SCHEDULES[data.period].label})`, "/calendar");
    await tx.shiftAssignment.deleteMany({ where: { shiftId: id } });
    await tx.shiftAssignment.createMany({ data: userIds.map((userId) => ({ shiftId: id, userId })) });
    await tx.auditLog.create({
      data: { actorUserId, action: "SHIFT_UPDATED", entityType: "Shift", entityId: id,
        metadata: { date: data.date, period: data.period, assignedUserIds: userIds } },
    });
    return tx.shift.findUniqueOrThrow({ where: { id }, include });
  });
}
export async function assignUsersToShift(id: string, userIds: string[], actorUserId?: string) {
  return serializable(async (tx) => {
    const shift = await tx.shift.findUnique({ where: { id } });
    if (!shift) throw new OperationError(404, "Guardia no encontrada");
    const ids = [...new Set(userIds)];
    await validateAssignments(tx, {
      date: shift.date.toISOString().slice(0, 10), period: shift.period || (shift.startTime >= "18:00" ? "NIGHT" : "DAY"),
      userIds: ids, excludeShiftId: id,
    });
    await tx.shiftAssignment.createMany({ data: ids.map((userId) => ({ shiftId: id, userId })), skipDuplicates: true });
    await notify(tx, ids.filter((userId) => userId !== actorUserId), `Guardia asignada: ${shift.date.toISOString().slice(0, 10)} (${shift.shiftType})`, "/calendar");
    await tx.auditLog.create({
      data: { actorUserId, action: "SHIFT_USERS_ASSIGNED", entityType: "Shift", entityId: id, metadata: { assignedUserIds: ids } },
    });
    return tx.shift.findUniqueOrThrow({ where: { id }, include });
  });
}
export async function deleteShift(id: string, actorUserId?: string) {
  return serializable(async (tx) => {
    const shift = await tx.shift.findUnique({ where: { id } });
    if (!shift) throw new OperationError(404, "Guardia no encontrada");
    const document = await tx.operationalDocument.findFirst({ where: { shiftId: id }, select: { id: true } });
    if (document) throw new OperationError(409, "La guardia tiene actas vinculadas y debe conservarse");
    await tx.shift.delete({ where: { id } });
    await tx.auditLog.create({
      data: { actorUserId, action: "SHIFT_DELETED", entityType: "Shift", entityId: id,
        metadata: { date: shift.date.toISOString(), period: shift.period } },
    });
    return { message: "Guardia eliminada" };
  });
}

// ---- M02: intercambio de turno entre bomberos, con aprobacion de jefatura ----
const SWAP_LOCK_MS = 24 * 3600000;
const swapInclude = { shift: { select: { id: true, date: true, period: true, shiftType: true, startTime: true, endTime: true } }, from: { select: PUBLIC_USER_SELECT }, to: { select: PUBLIC_USER_SELECT }, decidedBy: { select: PUBLIC_USER_SELECT } } as const;
function shiftStart(shift: { date: Date; startTime: string; endTime: string }) {
  return shiftInterval(shift.date.toISOString().slice(0, 10), shift.startTime, shift.endTime).start;
}
function assertSwapWindow(shift: { date: Date; startTime: string; endTime: string }) {
  if (shiftStart(shift) - Date.now() < SWAP_LOCK_MS) throw new OperationError(409, "Faltan menos de 24 horas para el turno: el intercambio está bloqueado y solo jefatura puede reasignar");
}
export async function listSwaps(actor: { userId: string; role: string }) {
  const manager = ["ADMIN", "OPERATOR"].includes(actor.role);
  return prisma.shiftSwapRequest.findMany({
    // 16: las ofertas abiertas de la bolsa de reemplazos las ve todo el personal.
    where: manager ? { OR: [{ status: { in: ["PENDING", "ACCEPTED", "OPEN"] } }, { fromUserId: actor.userId }, { toUserId: actor.userId }] } : { OR: [{ fromUserId: actor.userId }, { toUserId: actor.userId }, { status: "OPEN" }] },
    include: swapInclude, orderBy: [{ createdAt: "desc" }, { id: "asc" }], take: 100,
  });
}
export async function requestSwap(shiftId: string, input: { toUserId?: string; reason: string }, actorUserId: string) {
  return serializable(async (tx) => {
    const shift = await tx.shift.findUnique({ where: { id: shiftId }, include: { assignments: true } });
    if (!shift) throw new OperationError(404, "Guardia no encontrada");
    if (!shift.assignments.some((row) => row.userId === actorUserId)) throw new OperationError(403, "Solo puede proponer el intercambio de una guardia propia");
    assertSwapWindow(shift);
    if (await tx.shiftSwapRequest.findFirst({ where: { shiftId, fromUserId: actorUserId, status: { in: ["PENDING", "ACCEPTED", "OPEN"] } } })) throw new OperationError(409, "Ya tiene un intercambio en trámite para esta guardia");
    const day = shift.date.toISOString().slice(0, 10);
    // 16: sin destinatario, la guardia se publica en la bolsa de reemplazos para que la tome quien pueda.
    if (!input.toUserId) {
      const row = await tx.shiftSwapRequest.create({ data: { shiftId, fromUserId: actorUserId, reason: input.reason, isOpenOffer: true, status: "OPEN" }, include: swapInclude });
      await tx.auditLog.create({ data: { actorUserId, action: "SHIFT_SWAP_OFFERED", entityType: "Shift", entityId: shiftId, metadata: { swapId: row.id, reason: input.reason } } });
      const assigned = new Set(shift.assignments.map((a) => a.userId));
      const people = await tx.user.findMany({ where: { isActive: true, isPendingApproval: false, deletedAt: null }, select: { id: true, profile: { select: { rank: true } } } });
      const eligible = people.filter((p) => !assigned.has(p.id) && !["administrador", "comision directiva", "aspirante menor"].includes(normalizeRank(p.profile?.rank))).map((p) => p.id);
      await notify(tx, eligible, `Guardia disponible para cubrir: ${day} (${shift.shiftType})`, "/calendar", input.reason);
      return row;
    }
    if (input.toUserId === actorUserId || shift.assignments.some((row) => row.userId === input.toUserId)) throw new OperationError(400, "La persona elegida ya integra esa guardia");
    if (!await tx.user.findFirst({ where: { id: input.toUserId, isActive: true, isPendingApproval: false, deletedAt: null }, select: { id: true } })) throw new OperationError(400, "Seleccione personal activo");
    const row = await tx.shiftSwapRequest.create({ data: { shiftId, fromUserId: actorUserId, toUserId: input.toUserId, reason: input.reason }, include: swapInclude });
    await tx.auditLog.create({ data: { actorUserId, action: "SHIFT_SWAP_REQUESTED", entityType: "Shift", entityId: shiftId, metadata: { swapId: row.id, toUserId: input.toUserId, reason: input.reason } } });
    await notify(tx, [input.toUserId], `Le proponen cubrir una guardia: ${day} (${shift.shiftType})`, "/calendar", input.reason);
    return row;
  });
}
// 16: tomar una guardia de la bolsa equivale a aceptar el intercambio; luego decide jefatura.
export async function takeSwap(id: string, actorUserId: string) {
  return serializable(async (tx) => {
    const row = await tx.shiftSwapRequest.findUnique({ where: { id }, include: { shift: { include: { assignments: true } } } });
    if (!row || row.status !== "OPEN") throw new OperationError(409, "Esta guardia ya fue tomada o retirada de la bolsa");
    if (row.fromUserId === actorUserId || row.shift.assignments.some((a) => a.userId === actorUserId)) throw new OperationError(400, "Ya integra esa guardia");
    assertSwapWindow(row.shift);
    const actor = await tx.user.findFirst({ where: { id: actorUserId, isActive: true, isPendingApproval: false, deletedAt: null }, select: { profile: { select: { rank: true } } } });
    if (!actor || ["administrador", "comision directiva", "aspirante menor"].includes(normalizeRank(actor.profile?.rank))) throw new OperationError(403, "Su cargo no cubre guardias");
    const changed = await tx.shiftSwapRequest.updateMany({ where: { id, status: "OPEN" }, data: { status: "ACCEPTED", toUserId: actorUserId, acceptedAt: new Date() } });
    if (!changed.count) throw new OperationError(409, "Otra persona tomó esta guardia");
    await tx.auditLog.create({ data: { actorUserId, action: "SHIFT_SWAP_TAKEN", entityType: "Shift", entityId: row.shiftId, metadata: { swapId: id, from: row.fromUserId } } });
    await notify(tx, [row.fromUserId], "Alguien se ofreció a cubrir su guardia; falta la aprobación de jefatura", "/calendar");
    await notifyCommand(tx, "Reemplazo de guardia para aprobar", "/calendar", `${row.shift.date.toISOString().slice(0, 10)} (${row.shift.shiftType}): ${row.reason}`);
    return { status: "ACCEPTED" };
  });
}
export async function answerSwap(id: string, accept: boolean, actorUserId: string) {
  return serializable(async (tx) => {
    const row = await tx.shiftSwapRequest.findUnique({ where: { id }, include: { shift: true } });
    const own = row?.fromUserId === actorUserId;
    // Quien publico una oferta abierta puede retirarla mientras nadie la tome.
    if (row && row.status === "OPEN") {
      if (!own || accept) throw new OperationError(403, "Para cubrir una guardia de la bolsa use la opción Tomar guardia");
      await tx.shiftSwapRequest.update({ where: { id }, data: { status: "CANCELLED", decidedAt: new Date() } });
      await tx.auditLog.create({ data: { actorUserId, action: "SHIFT_SWAP_CANCELLED", entityType: "Shift", entityId: row.shiftId, metadata: { swapId: id, openOffer: true } } });
      return { status: "CANCELLED" };
    }
    if (!row || row.status !== "PENDING") throw new OperationError(409, "El intercambio ya fue respondido o cancelado");
    if (!own && row.toUserId !== actorUserId) throw new OperationError(403, "Solo la persona propuesta responde el intercambio");
    if (own && accept) throw new OperationError(403, "Quien propone solo puede cancelar su pedido");
    if (accept) assertSwapWindow(row.shift);
    const status = accept ? "ACCEPTED" : own ? "CANCELLED" : "REJECTED";
    await tx.shiftSwapRequest.update({ where: { id }, data: { status, ...(accept ? { acceptedAt: new Date() } : { decidedAt: new Date() }) } });
    await tx.auditLog.create({ data: { actorUserId, action: `SHIFT_SWAP_${status}`, entityType: "Shift", entityId: row.shiftId, metadata: { swapId: id } } });
    if (accept) await notifyCommand(tx, "Intercambio de guardia para aprobar", "/calendar", `${row.shift.date.toISOString().slice(0, 10)} (${row.shift.shiftType}): ${row.reason}`);
    if (!own) await notify(tx, [row.fromUserId], accept ? "Su intercambio de guardia fue aceptado; falta la aprobación de jefatura" : "Su intercambio de guardia fue rechazado", "/calendar");
    return { status };
  });
}
export async function decideSwap(id: string, input: { approve: boolean; note: string }, actor: { userId: string; role: string }) {
  if (!["ADMIN", "OPERATOR"].includes(actor.role)) throw new OperationError(403, "Solo jefatura aprueba intercambios de guardia");
  return serializable(async (tx) => {
    const row = await tx.shiftSwapRequest.findUnique({ where: { id }, include: { shift: { include: { assignments: true } } } });
    if (!row || row.status !== "ACCEPTED" || !row.toUserId) throw new OperationError(409, "El intercambio no está aceptado por ambas personas o ya fue resuelto");
    const toUserId = row.toUserId;
    if ([row.fromUserId, row.toUserId].includes(actor.userId)) throw new OperationError(403, "Otra persona de jefatura debe resolver un intercambio propio");
    const status = input.approve ? "APPROVED" : "REJECTED";
    if (input.approve) {
      assertSwapWindow(row.shift);
      if (!row.shift.assignments.some((a) => a.userId === row.fromUserId)) throw new OperationError(409, "Quien pidió el intercambio ya no integra la guardia");
      await validateAssignments(tx, { date: row.shift.date.toISOString().slice(0, 10), period: row.shift.period || (row.shift.startTime >= "18:00" ? "NIGHT" : "DAY"), userIds: [toUserId], excludeShiftId: row.shiftId });
      await tx.shiftAssignment.delete({ where: { shiftId_userId: { shiftId: row.shiftId, userId: row.fromUserId } } });
      await tx.shiftAssignment.create({ data: { shiftId: row.shiftId, userId: toUserId } });
    }
    await tx.shiftSwapRequest.update({ where: { id }, data: { status, decidedByUserId: actor.userId, decidedAt: new Date(), decisionNote: input.note } });
    await tx.auditLog.create({ data: { actorUserId: actor.userId, action: `SHIFT_SWAP_${status}`, entityType: "Shift", entityId: row.shiftId, metadata: { swapId: id, from: row.fromUserId, to: row.toUserId, note: input.note } } });
    await notify(tx, [row.fromUserId, toUserId], input.approve ? "Intercambio de guardia aprobado" : "Intercambio de guardia rechazado por jefatura", "/calendar", input.note);
    return { status };
  });
}
