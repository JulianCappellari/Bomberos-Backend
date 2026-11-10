"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SHIFT_SCHEDULES = void 0;
exports.createShift = createShift;
exports.getAllShifts = getAllShifts;
exports.getShiftById = getShiftById;
exports.updateShift = updateShift;
exports.assignUsersToShift = assignUsersToShift;
exports.deleteShift = deleteShift;
exports.listSwaps = listSwaps;
exports.requestSwap = requestSwap;
exports.answerSwap = answerSwap;
exports.decideSwap = decideSwap;
const prisma_1 = require("../../config/prisma");
const shifts_rules_1 = require("./shifts.rules");
const public_user_1 = require("../../utils/public-user");
const transaction_1 = require("../../utils/transaction");
const operations_schemas_1 = require("../operations/operations.schemas");
const shifts_rules_2 = require("./shifts.rules");
const notifications_service_1 = require("../members/notifications.service");
exports.SHIFT_SCHEDULES = {
    DAY: { startTime: "08:00", endTime: "20:00", label: "Guardia diurna" },
    NIGHT: { startTime: "20:00", endTime: "08:00", label: "Guardia nocturna" },
};
const include = {
    createdBy: { select: public_user_1.PUBLIC_USER_SELECT },
    assignments: { include: { user: { select: public_user_1.PUBLIC_USER_SELECT } } },
};
const dateOnly = (value) => new Date(value + "T00:00:00Z");
async function validateAssignments(tx, data) {
    if (!data.userIds.length)
        throw new operations_schemas_1.OperationError(400, "La guardia debe tener personal asignado");
    const users = await tx.user.findMany({
        where: { id: { in: data.userIds }, isActive: true, isPendingApproval: false, deletedAt: null },
        select: { id: true },
    });
    if (users.length !== data.userIds.length)
        throw new operations_schemas_1.OperationError(400, "Hay integrantes no habilitados");
    const unavailable = await tx.personnelAvailability.findFirst({
        where: { date: dateOnly(data.date), period: data.period, userId: { in: data.userIds }, status: "UNAVAILABLE" },
        include: { user: { select: public_user_1.PUBLIC_USER_SELECT } },
    });
    if (unavailable)
        throw new operations_schemas_1.OperationError(409, `${unavailable.user.profile?.fullName || unavailable.user.username} no esta disponible para ese turno`);
    // D07: una ausencia programada bloquea nuevas asignaciones de guardia que se superpongan.
    const window = (0, shifts_rules_2.shiftInterval)(data.date, exports.SHIFT_SCHEDULES[data.period].startTime, exports.SHIFT_SCHEDULES[data.period].endTime);
    const absent = await tx.emergencyAvailability.findFirst({
        where: { userId: { in: data.userIds.filter((id) => !data.keepUserIds?.includes(id)) }, cancelledAt: null, startsAt: { lt: new Date(window.end) }, OR: [{ endsAt: null }, { endsAt: { gt: new Date(Math.max(window.start, Date.now())) } }] },
        include: { user: { select: public_user_1.PUBLIC_USER_SELECT } },
    });
    if (absent && window.end > Date.now())
        throw new operations_schemas_1.OperationError(409, `${absent.user.profile?.fullName || absent.user.username} declaró una ausencia que se superpone con ese turno`);
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
    const schedule = exports.SHIFT_SCHEDULES[data.period];
    for (const shift of shifts) {
        if (!(0, shifts_rules_1.shiftsOverlap)({ date: data.date, ...schedule }, {
            date: shift.date.toISOString().slice(0, 10), startTime: shift.startTime, endTime: shift.endTime,
        }))
            continue;
        const person = shift.assignments.find((assignment) => data.userIds.includes(assignment.userId)).user;
        throw new operations_schemas_1.OperationError(409, `${person.profile?.fullName || person.username} ya tiene una guardia en ese horario`);
    }
}
async function ensurePeriodFree(tx, data, exceptId) {
    const existing = await tx.shift.findFirst({
        where: { date: dateOnly(data.date), period: data.period, ...(exceptId ? { id: { not: exceptId } } : {}) },
        select: { id: true },
    });
    if (existing)
        throw new operations_schemas_1.OperationError(409, "Ya existe ese turno para la fecha seleccionada");
}
function fields(data) {
    const schedule = exports.SHIFT_SCHEDULES[data.period];
    return {
        date: dateOnly(data.date), period: data.period, startTime: schedule.startTime,
        endTime: schedule.endTime, shiftType: schedule.label, notes: data.notes?.trim() || null,
    };
}
async function createShift(data) {
    return (0, transaction_1.serializable)(async (tx) => {
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
        await (0, notifications_service_1.notify)(tx, userIds.filter((id) => id !== data.createdByUserId), `Guardia asignada: ${data.date} (${exports.SHIFT_SCHEDULES[data.period].label})`, "/calendar");
        return shift;
    });
}
async function getAllShifts(filters) {
    return prisma_1.prisma.shift.findMany({
        where: filters?.date ? { date: dateOnly(filters.date) } : {
            date: { ...(filters?.from ? { gte: dateOnly(filters.from) } : {}), ...(filters?.to ? { lte: dateOnly(filters.to) } : {}) },
        },
        include, orderBy: [{ date: "asc" }, { startTime: "asc" }],
    });
}
async function getShiftById(id) {
    const shift = await prisma_1.prisma.shift.findUnique({ where: { id }, include });
    if (!shift)
        throw new operations_schemas_1.OperationError(404, "Guardia no encontrada");
    return shift;
}
async function updateShift(id, data, actorUserId) {
    return (0, transaction_1.serializable)(async (tx) => {
        const existing = await tx.shift.findUnique({ where: { id } });
        if (!existing)
            throw new operations_schemas_1.OperationError(404, "Guardia no encontrada");
        const userIds = [...new Set(data.assignedUserIds || [])];
        const previousIds = (await tx.shiftAssignment.findMany({ where: { shiftId: id }, select: { userId: true } })).map((row) => row.userId);
        await ensurePeriodFree(tx, data, id);
        await validateAssignments(tx, { ...data, userIds, excludeShiftId: id, keepUserIds: previousIds });
        await tx.shift.update({ where: { id }, data: fields(data) });
        await tx.shiftSwapRequest.updateMany({ where: { shiftId: id, status: { in: ["PENDING", "ACCEPTED"] } }, data: { status: "CANCELLED", decidedAt: new Date(), decisionNote: "La guardia fue reprogramada por jefatura" } });
        // M02: toda reasignacion de jefatura se notifica a quienes entran y a quienes salen del turno.
        await (0, notifications_service_1.notify)(tx, userIds.filter((userId) => !previousIds.includes(userId) && userId !== actorUserId), `Guardia asignada: ${data.date} (${exports.SHIFT_SCHEDULES[data.period].label})`, "/calendar");
        await (0, notifications_service_1.notify)(tx, previousIds.filter((userId) => !userIds.includes(userId) && userId !== actorUserId), `Fue relevado de la guardia del ${data.date} (${exports.SHIFT_SCHEDULES[data.period].label})`, "/calendar");
        await tx.shiftAssignment.deleteMany({ where: { shiftId: id } });
        await tx.shiftAssignment.createMany({ data: userIds.map((userId) => ({ shiftId: id, userId })) });
        await tx.auditLog.create({
            data: { actorUserId, action: "SHIFT_UPDATED", entityType: "Shift", entityId: id,
                metadata: { date: data.date, period: data.period, assignedUserIds: userIds } },
        });
        return tx.shift.findUniqueOrThrow({ where: { id }, include });
    });
}
async function assignUsersToShift(id, userIds, actorUserId) {
    return (0, transaction_1.serializable)(async (tx) => {
        const shift = await tx.shift.findUnique({ where: { id } });
        if (!shift)
            throw new operations_schemas_1.OperationError(404, "Guardia no encontrada");
        const ids = [...new Set(userIds)];
        await validateAssignments(tx, {
            date: shift.date.toISOString().slice(0, 10), period: shift.period || (shift.startTime >= "18:00" ? "NIGHT" : "DAY"),
            userIds: ids, excludeShiftId: id,
        });
        await tx.shiftAssignment.createMany({ data: ids.map((userId) => ({ shiftId: id, userId })), skipDuplicates: true });
        await (0, notifications_service_1.notify)(tx, ids.filter((userId) => userId !== actorUserId), `Guardia asignada: ${shift.date.toISOString().slice(0, 10)} (${shift.shiftType})`, "/calendar");
        await tx.auditLog.create({
            data: { actorUserId, action: "SHIFT_USERS_ASSIGNED", entityType: "Shift", entityId: id, metadata: { assignedUserIds: ids } },
        });
        return tx.shift.findUniqueOrThrow({ where: { id }, include });
    });
}
async function deleteShift(id, actorUserId) {
    return (0, transaction_1.serializable)(async (tx) => {
        const shift = await tx.shift.findUnique({ where: { id } });
        if (!shift)
            throw new operations_schemas_1.OperationError(404, "Guardia no encontrada");
        const document = await tx.operationalDocument.findFirst({ where: { shiftId: id }, select: { id: true } });
        if (document)
            throw new operations_schemas_1.OperationError(409, "La guardia tiene actas vinculadas y debe conservarse");
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
const swapInclude = { shift: { select: { id: true, date: true, period: true, shiftType: true, startTime: true, endTime: true } }, from: { select: public_user_1.PUBLIC_USER_SELECT }, to: { select: public_user_1.PUBLIC_USER_SELECT }, decidedBy: { select: public_user_1.PUBLIC_USER_SELECT } };
function shiftStart(shift) {
    return (0, shifts_rules_2.shiftInterval)(shift.date.toISOString().slice(0, 10), shift.startTime, shift.endTime).start;
}
function assertSwapWindow(shift) {
    if (shiftStart(shift) - Date.now() < SWAP_LOCK_MS)
        throw new operations_schemas_1.OperationError(409, "Faltan menos de 24 horas para el turno: el intercambio está bloqueado y solo jefatura puede reasignar");
}
async function listSwaps(actor) {
    const manager = ["ADMIN", "OPERATOR"].includes(actor.role);
    return prisma_1.prisma.shiftSwapRequest.findMany({
        where: manager ? { OR: [{ status: { in: ["PENDING", "ACCEPTED"] } }, { fromUserId: actor.userId }, { toUserId: actor.userId }] } : { OR: [{ fromUserId: actor.userId }, { toUserId: actor.userId }] },
        include: swapInclude, orderBy: [{ createdAt: "desc" }, { id: "asc" }], take: 100,
    });
}
async function requestSwap(shiftId, input, actorUserId) {
    return (0, transaction_1.serializable)(async (tx) => {
        const shift = await tx.shift.findUnique({ where: { id: shiftId }, include: { assignments: true } });
        if (!shift)
            throw new operations_schemas_1.OperationError(404, "Guardia no encontrada");
        if (!shift.assignments.some((row) => row.userId === actorUserId))
            throw new operations_schemas_1.OperationError(403, "Solo puede proponer el intercambio de una guardia propia");
        if (input.toUserId === actorUserId || shift.assignments.some((row) => row.userId === input.toUserId))
            throw new operations_schemas_1.OperationError(400, "La persona elegida ya integra esa guardia");
        assertSwapWindow(shift);
        if (!await tx.user.findFirst({ where: { id: input.toUserId, isActive: true, isPendingApproval: false, deletedAt: null }, select: { id: true } }))
            throw new operations_schemas_1.OperationError(400, "Seleccione personal activo");
        if (await tx.shiftSwapRequest.findFirst({ where: { shiftId, fromUserId: actorUserId, status: { in: ["PENDING", "ACCEPTED"] } } }))
            throw new operations_schemas_1.OperationError(409, "Ya tiene un intercambio en trámite para esta guardia");
        const row = await tx.shiftSwapRequest.create({ data: { shiftId, fromUserId: actorUserId, toUserId: input.toUserId, reason: input.reason }, include: swapInclude });
        await tx.auditLog.create({ data: { actorUserId, action: "SHIFT_SWAP_REQUESTED", entityType: "Shift", entityId: shiftId, metadata: { swapId: row.id, toUserId: input.toUserId, reason: input.reason } } });
        await (0, notifications_service_1.notify)(tx, [input.toUserId], `Le proponen cubrir una guardia: ${shift.date.toISOString().slice(0, 10)} (${shift.shiftType})`, "/calendar", input.reason);
        return row;
    });
}
async function answerSwap(id, accept, actorUserId) {
    return (0, transaction_1.serializable)(async (tx) => {
        const row = await tx.shiftSwapRequest.findUnique({ where: { id }, include: { shift: true } });
        if (!row || row.status !== "PENDING")
            throw new operations_schemas_1.OperationError(409, "El intercambio ya fue respondido o cancelado");
        const own = row.fromUserId === actorUserId;
        if (!own && row.toUserId !== actorUserId)
            throw new operations_schemas_1.OperationError(403, "Solo la persona propuesta responde el intercambio");
        if (own && accept)
            throw new operations_schemas_1.OperationError(403, "Quien propone solo puede cancelar su pedido");
        if (accept)
            assertSwapWindow(row.shift);
        const status = accept ? "ACCEPTED" : own ? "CANCELLED" : "REJECTED";
        await tx.shiftSwapRequest.update({ where: { id }, data: { status, ...(accept ? { acceptedAt: new Date() } : { decidedAt: new Date() }) } });
        await tx.auditLog.create({ data: { actorUserId, action: `SHIFT_SWAP_${status}`, entityType: "Shift", entityId: row.shiftId, metadata: { swapId: id } } });
        if (accept)
            await (0, notifications_service_1.notifyCommand)(tx, "Intercambio de guardia para aprobar", "/calendar", `${row.shift.date.toISOString().slice(0, 10)} (${row.shift.shiftType}): ${row.reason}`);
        if (!own)
            await (0, notifications_service_1.notify)(tx, [row.fromUserId], accept ? "Su intercambio de guardia fue aceptado; falta la aprobación de jefatura" : "Su intercambio de guardia fue rechazado", "/calendar");
        return { status };
    });
}
async function decideSwap(id, input, actor) {
    if (!["ADMIN", "OPERATOR"].includes(actor.role))
        throw new operations_schemas_1.OperationError(403, "Solo jefatura aprueba intercambios de guardia");
    return (0, transaction_1.serializable)(async (tx) => {
        const row = await tx.shiftSwapRequest.findUnique({ where: { id }, include: { shift: { include: { assignments: true } } } });
        if (!row || row.status !== "ACCEPTED")
            throw new operations_schemas_1.OperationError(409, "El intercambio no está aceptado por ambas personas o ya fue resuelto");
        if ([row.fromUserId, row.toUserId].includes(actor.userId))
            throw new operations_schemas_1.OperationError(403, "Otra persona de jefatura debe resolver un intercambio propio");
        const status = input.approve ? "APPROVED" : "REJECTED";
        if (input.approve) {
            assertSwapWindow(row.shift);
            if (!row.shift.assignments.some((a) => a.userId === row.fromUserId))
                throw new operations_schemas_1.OperationError(409, "Quien pidió el intercambio ya no integra la guardia");
            await validateAssignments(tx, { date: row.shift.date.toISOString().slice(0, 10), period: row.shift.period || (row.shift.startTime >= "18:00" ? "NIGHT" : "DAY"), userIds: [row.toUserId], excludeShiftId: row.shiftId });
            await tx.shiftAssignment.delete({ where: { shiftId_userId: { shiftId: row.shiftId, userId: row.fromUserId } } });
            await tx.shiftAssignment.create({ data: { shiftId: row.shiftId, userId: row.toUserId } });
        }
        await tx.shiftSwapRequest.update({ where: { id }, data: { status, decidedByUserId: actor.userId, decidedAt: new Date(), decisionNote: input.note } });
        await tx.auditLog.create({ data: { actorUserId: actor.userId, action: `SHIFT_SWAP_${status}`, entityType: "Shift", entityId: row.shiftId, metadata: { swapId: id, from: row.fromUserId, to: row.toUserId, note: input.note } } });
        await (0, notifications_service_1.notify)(tx, [row.fromUserId, row.toUserId], input.approve ? "Intercambio de guardia aprobado" : "Intercambio de guardia rechazado por jefatura", "/calendar", input.note);
        return { status };
    });
}
