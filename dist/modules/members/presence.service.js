"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.presenceSchema = void 0;
exports.presenceDueAt = presenceDueAt;
exports.assertPresenceLocation = assertPresenceLocation;
exports.presenceState = presenceState;
exports.markPromptShown = markPromptShown;
exports.expirePresence = expirePresence;
exports.confirmPresence = confirmPresence;
const zod_1 = require("zod");
const prisma_1 = require("../../config/prisma");
const transaction_1 = require("../../utils/transaction");
const operations_schemas_1 = require("../operations/operations.schemas");
const attendance_utils_1 = require("../attendance/attendance.utils");
const shifts_rules_1 = require("../shifts/shifts.rules");
const presence_policy_1 = require("./presence-policy");
const station_time_1 = require("../../utils/station-time");
const notifications_service_1 = require("./notifications.service");
const gps_suspicion_1 = require("../../utils/gps-suspicion");
const GRACE = 15 * 60000;
function windowTimes(shown) {
    return { retryAt: new Date(+shown + GRACE), expiresAt: new Date(+shown + 2 * GRACE) };
}
exports.presenceSchema = zod_1.z.discriminatedUnion("inside", [
    zod_1.z.object({ attendanceId: zod_1.z.string().min(1), inside: zod_1.z.literal(false) }).strict(),
    zod_1.z.object({ attendanceId: zod_1.z.string().min(1), inside: zod_1.z.literal(true), latitude: zod_1.z.number().finite().min(-90).max(90), longitude: zod_1.z.number().finite().min(-180).max(180), accuracy: zod_1.z.number().finite().min(0).max(50), capturedAt: zod_1.z.string().datetime({ offset: true }) }).strict(),
]);
function presenceDueAt(row) {
    const base = [row.checkInAt, row.lastPresenceConfirmedAt, row.presenceResumeAt].filter((date) => Boolean(date)).sort((a, b) => b.getTime() - a.getTime())[0];
    return base ? new Date(base.getTime() + 30 * 60000) : null;
}
async function effectivePresenceDue(tx, userId, row) {
    const ordinary = presenceDueAt(row);
    if (!row.checkInAt || !ordinary)
        return { dueAt: ordinary, guardUntil: null };
    const first = new Date((0, station_time_1.stationDate)(new Date(row.checkInAt.getTime() - 86400000)));
    const shifts = await tx.shift.findMany({ where: { date: { gte: first }, assignments: { some: { userId } } }, orderBy: { date: "asc" }, take: 100, select: { date: true, startTime: true, endTime: true, period: true } });
    const base = [row.checkInAt, row.lastPresenceConfirmedAt, row.presenceResumeAt].filter((date) => Boolean(date)).sort((a, b) => b.getTime() - a.getTime())[0];
    const until = (0, presence_policy_1.guardPresenceUntil)(base, shifts.map(s => (0, shifts_rules_1.shiftInterval)(s.date.toISOString().slice(0, 10), s.period === "DAY" ? "08:00" : s.period === "NIGHT" ? "20:00" : s.startTime, s.period === "DAY" ? "20:00" : s.period === "NIGHT" ? "08:00" : s.endTime)));
    return { dueAt: until && until > ordinary ? until : ordinary, guardUntil: until };
}
function assertPresenceLocation(input, station, now = new Date()) {
    const age = now.getTime() - new Date(input.capturedAt).getTime();
    if (!Number.isFinite(age) || age < -5000 || age > 60000)
        throw new operations_schemas_1.OperationError(400, "Solicite una ubicacion reciente");
    const distance = (0, attendance_utils_1.getDistanceMeters)(input.latitude, input.longitude, station.latitude, station.longitude);
    if (input.accuracy > 50 || distance + input.accuracy > 100)
        throw new operations_schemas_1.OperationError(400, "La ubicacion no permite confirmar presencia dentro de los 100 metros de la base");
    return distance;
}
async function presenceState(userId) {
    return prisma_1.prisma.$transaction(async (tx) => {
        const row = await tx.attendance.findFirst({ where: { userId, status: "OPEN", checkInQrId: { not: null }, checkInAt: { lte: new Date() }, checkInTrust: { not: "REJECTED" } }, orderBy: { checkInAt: "desc" }, select: { id: true, checkInAt: true, lastPresenceConfirmedAt: true, presenceResumeAt: true, promptShownAt: true, promptDueAt: true, station: { select: { name: true } } } });
        if (!row)
            return { attendance: null, dueAt: null, needsConfirmation: false };
        const mission = await tx.missionCrew.findFirst({ where: { userId, movement: { returnedAt: null } }, select: { movementId: true } });
        if (mission)
            return { attendance: { id: row.id, stationName: row.station.name }, dueAt: null, needsConfirmation: false, suspendedForMission: mission.movementId };
        const { dueAt, guardUntil } = await effectivePresenceDue(tx, userId, row);
        return { attendance: { id: row.id, stationName: row.station.name }, dueAt, guardUntil, needsConfirmation: Boolean(dueAt && dueAt <= new Date()), ...(row.promptShownAt && row.promptDueAt?.getTime() === dueAt?.getTime() ? windowTimes(row.promptShownAt) : {}) };
    }, { isolationLevel: "RepeatableRead" });
}
async function markPromptShown(userId, attendanceId, expectedDue) {
    return (0, transaction_1.serializable)(async (tx) => {
        const row = await tx.attendance.findFirst({ where: { id: attendanceId, userId, status: "OPEN", checkInQrId: { not: null }, checkInTrust: { not: "REJECTED" } } });
        if (!row || await tx.missionCrew.findFirst({ where: { userId, movement: { returnedAt: null } } }))
            throw new operations_schemas_1.OperationError(409, "La verificación ya no está pendiente");
        const { dueAt } = await effectivePresenceDue(tx, userId, row), now = new Date();
        if (!dueAt || dueAt > now || +dueAt !== Date.parse(expectedDue))
            throw new operations_schemas_1.OperationError(409, "La verificación cambió");
        if (row.promptShownAt && row.promptDueAt?.getTime() === +dueAt)
            return windowTimes(row.promptShownAt);
        await tx.attendance.update({ where: { id: row.id }, data: { promptShownAt: now, promptDueAt: dueAt } });
        return windowTimes(now);
    });
}
async function expirePresence(id, now = new Date()) {
    return (0, transaction_1.serializable)(async (tx) => {
        const row = await tx.attendance.findFirst({ where: { id, status: "OPEN", checkInQrId: { not: null }, checkInTrust: { not: "REJECTED" } } });
        if (!row?.checkInAt || !row.promptShownAt || !row.promptDueAt)
            return false;
        const { expiresAt } = windowTimes(row.promptShownAt);
        if (now < expiresAt)
            return false;
        const { dueAt } = await effectivePresenceDue(tx, row.userId, row);
        if (dueAt?.getTime() !== +row.promptDueAt || await tx.missionCrew.findFirst({ where: { userId: row.userId, movement: { returnedAt: null } } })) {
            await tx.attendance.update({ where: { id }, data: { promptDueAt: null, promptShownAt: null } });
            return false;
        }
        await tx.attendance.update({ where: { id }, data: { status: "CLOSED", checkOutAt: expiresAt, checkOutTrust: null, workedMinutes: Math.max(0, Math.floor((+expiresAt - +row.checkInAt) / 60000)), discardedAt: expiresAt, discardReason: "Cierre automatico sin revalidacion" } });
        await tx.auditLog.create({ data: { action: "SYSTEM_PRESENCE_TIMED_OUT", entityType: "Attendance", entityId: id, metadata: { userId: row.userId, shownAt: row.promptShownAt.toISOString(), closedAt: expiresAt.toISOString(), reason: "Sin confirmación válida en el plazo", discarded: true } } });
        await (0, notifications_service_1.notify)(tx, [row.userId], "Permanencia cerrada por falta de confirmación", "/attendance", "La permanencia completa quedó descartada: no suma horas ni puntos. Para volver a ingresar, escanee el QR.");
        return true;
    });
}
async function confirmPresence(input, userId) {
    return (0, transaction_1.serializable)(async (tx) => {
        const row = await tx.attendance.findFirst({ where: { id: input.attendanceId, userId, status: "OPEN" }, include: { station: true } });
        if (!row || !row.checkInAt)
            throw new operations_schemas_1.OperationError(409, "La permanencia ya termino o cambio");
        if (await tx.missionCrew.findFirst({ where: { userId, movement: { returnedAt: null } } }))
            throw new operations_schemas_1.OperationError(409, "La verificacion permanece suspendida durante la salida a intervencion");
        const now = new Date();
        if (row.promptShownAt && now >= windowTimes(row.promptShownAt).expiresAt) {
            const { dueAt } = await effectivePresenceDue(tx, userId, row);
            if (dueAt && row.promptDueAt?.getTime() === +dueAt)
                throw new operations_schemas_1.OperationError(409, "El plazo venció; el contador se cerrará automáticamente");
        }
        if (input.inside && !row.checkInQrId)
            throw new operations_schemas_1.OperationError(409, "Esta permanencia no proviene de un ingreso QR");
        if (!input.inside) {
            const changed = await tx.attendance.updateMany({ where: { id: row.id, status: "OPEN", userId }, data: { status: "CLOSED", checkOutAt: now, workedMinutes: Math.max(0, Math.floor((now.getTime() - row.checkInAt.getTime()) / 60000)), checkOutTrust: "MEDIUM" } });
            if (!changed.count)
                throw new operations_schemas_1.OperationError(409, "La permanencia ya se cerro");
        }
        else {
            const { dueAt } = await effectivePresenceDue(tx, userId, row);
            if (!dueAt)
                throw new operations_schemas_1.OperationError(409, "Permanencia sin hora de ingreso valida");
            if (dueAt > now)
                throw new operations_schemas_1.OperationError(409, "La presencia ya fue confirmada recientemente");
            assertPresenceLocation(input, row.station, now);
            await (0, gps_suspicion_1.recordGpsSuspicion)(tx, userId, row.id, "Revalidación de presencia", (0, gps_suspicion_1.gpsSuspicionReasons)(input, { latitude: row.checkInLatitude, longitude: row.checkInLongitude }));
            await tx.attendance.update({ where: { id: row.id }, data: { lastPresenceConfirmedAt: now, promptShownAt: null, promptDueAt: null } });
        }
        await tx.auditLog.create({ data: { actorUserId: userId, action: input.inside ? "PRESENCE_CONFIRMED" : "PRESENCE_EXIT_DECLARED", entityType: "Attendance", entityId: row.id } });
        return { message: input.inside ? "Presencia confirmada por 30 minutos" : "Permanencia cerrada" };
    });
}
