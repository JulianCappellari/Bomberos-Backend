"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cancelParticipationSchema = exports.participationSchema = void 0;
exports.validateParticipationInterval = validateParticipationInterval;
exports.listParticipations = listParticipations;
exports.recordParticipation = recordParticipation;
exports.cancelParticipation = cancelParticipation;
exports.verifyParticipation = verifyParticipation;
const zod_1 = require("zod");
const prisma_1 = require("../../config/prisma");
const transaction_1 = require("../../utils/transaction");
const public_user_1 = require("../../utils/public-user");
const operations_schemas_1 = require("../operations/operations.schemas");
const shifts_rules_1 = require("../shifts/shifts.rules");
const notifications_service_1 = require("./notifications.service");
exports.participationSchema = zod_1.z.object({
    userId: zod_1.z.string().min(1).max(100), shiftId: zod_1.z.string().min(1).max(100).optional(), incidentId: zod_1.z.string().min(1).max(100).optional(),
    startedAt: zod_1.z.string().datetime({ offset: true }), endedAt: zod_1.z.string().datetime({ offset: true }), notes: zod_1.z.string().trim().min(10).max(2000),
}).strict().refine((v) => Boolean(v.shiftId) !== Boolean(v.incidentId), "Seleccione una guardia o una intervencion, no ambas").refine((v) => new Date(v.endedAt) > new Date(v.startedAt), "La salida debe ser posterior al ingreso");
exports.cancelParticipationSchema = zod_1.z.object({ revision: zod_1.z.number().int().positive(), reason: zod_1.z.string().trim().min(10).max(2000) }).strict();
function validateParticipationInterval(start, end, bounds, now = new Date()) {
    if (start >= end || end > now || start.getTime() < bounds.start || end.getTime() > bounds.end)
        throw new operations_schemas_1.OperationError(400, "La asistencia debe estar dentro del servicio y no puede ser futura");
}
async function listParticipations(userId, page, actor) {
    if (!(0, operations_schemas_1.isOperationsManager)(actor.role))
        throw new operations_schemas_1.OperationError(403, "Solo mando puede consultar registros de asistencias");
    return prisma_1.prisma.$transaction(async (tx) => {
        const where = { userId };
        if (actor.userId !== userId)
            await tx.auditLog.create({ data: { actorUserId: actor.userId, action: "SERVICE_ATTENDANCE_VIEWED", entityType: "User", entityId: userId } });
        const items = await tx.serviceParticipation.findMany({ where, include: { user: { select: public_user_1.PUBLIC_USER_SELECT }, registeredBy: { select: public_user_1.PUBLIC_USER_SELECT }, shift: { select: { date: true, shiftType: true } }, incident: { select: { title: true } } }, orderBy: [{ startedAt: "desc" }, { id: "desc" }], skip: (page - 1) * 30, take: 30 });
        return { items, total: await tx.serviceParticipation.count({ where }), page, pageSize: 30 };
    }, { isolationLevel: "RepeatableRead" });
}
async function recordParticipation(input, actor) {
    if (!(0, operations_schemas_1.isOperationsManager)(actor.role) && input.userId !== actor.userId)
        throw new operations_schemas_1.OperationError(403, "Solo puede informar su propia asistencia");
    return (0, transaction_1.serializable)(async (tx) => {
        if (!await tx.user.findFirst({ where: { id: input.userId, deletedAt: null, isActive: true, isPendingApproval: false }, select: { id: true } }))
            throw new operations_schemas_1.OperationError(400, "El integrante no esta activo");
        const start = new Date(input.startedAt), end = new Date(input.endedAt);
        if (input.shiftId) {
            const shift = await tx.shift.findUnique({ where: { id: input.shiftId }, include: { assignments: { where: { userId: input.userId }, select: { id: true } } } });
            if (!shift || !shift.assignments.length)
                throw new operations_schemas_1.OperationError(400, "La persona debe estar asignada a la guardia");
            validateParticipationInterval(start, end, (0, shifts_rules_1.shiftInterval)(shift.date.toISOString().slice(0, 10), shift.startTime, shift.endTime));
        }
        else {
            const incident = await tx.incident.findUnique({ where: { id: input.incidentId }, include: { assignments: { where: { userId: input.userId }, select: { id: true } } } });
            if (!incident || !incident.assignments.length || !incident.closedAt || incident.status !== "CLOSED")
                throw new operations_schemas_1.OperationError(400, "La intervencion debe estar cerrada y la persona asignada");
            validateParticipationInterval(start, end, { start: incident.occurredAt.getTime(), end: incident.closedAt.getTime() });
        }
        const exists = await tx.serviceParticipation.findFirst({ where: { userId: input.userId, cancelledAt: null, ...(input.shiftId ? { shiftId: input.shiftId } : { incidentId: input.incidentId }) } });
        if (exists)
            throw new operations_schemas_1.OperationError(409, "Ya existe asistencia activa para ese servicio; anule con motivo si debe corregirla");
        // An emergency can happen during a shift; totals merge both time intervals.
        const overlap = await tx.serviceParticipation.findFirst({ where: { userId: input.userId, cancelledAt: null, ...(input.shiftId ? { shiftId: { not: null } } : { incidentId: { not: null } }), startedAt: { lt: end }, endedAt: { gt: start } } });
        if (overlap)
            throw new operations_schemas_1.OperationError(409, "La asistencia se superpone con otra guardia o intervencion del mismo tipo");
        const row = await tx.serviceParticipation.create({ data: { ...input, startedAt: start, endedAt: end, registeredByUserId: actor.userId, verifiedAt: (0, operations_schemas_1.isOperationsManager)(actor.role) ? new Date() : null } });
        await (0, notifications_service_1.notify)(tx, [input.userId], "Se registro su asistencia a un servicio", "/participations");
        await tx.auditLog.create({ data: { actorUserId: actor.userId, action: "SERVICE_ATTENDANCE_RECORDED", entityType: "ServiceParticipation", entityId: row.id, metadata: { snapshot: JSON.parse(JSON.stringify(row)) } } });
        return row;
    });
}
async function cancelParticipation(id, input, actor) {
    if (!(0, operations_schemas_1.isOperationsManager)(actor.role))
        throw new operations_schemas_1.OperationError(403, "Solo mando puede anular asistencias");
    return (0, transaction_1.serializable)(async (tx) => {
        const changed = await tx.serviceParticipation.updateMany({ where: { id, revision: input.revision, cancelledAt: null }, data: { cancelledAt: new Date(), cancelReason: input.reason, revision: { increment: 1 } } });
        if (!changed.count)
            throw new operations_schemas_1.OperationError(409, "La asistencia cambio o ya fue anulada");
        await tx.auditLog.create({ data: { actorUserId: actor.userId, action: "SERVICE_ATTENDANCE_CANCELLED", entityType: "ServiceParticipation", entityId: id, metadata: { reason: input.reason } } });
        return { message: "Asistencia anulada; se conserva el registro" };
    });
}
async function verifyParticipation(id, revision, actor) {
    if (!(0, operations_schemas_1.isOperationsManager)(actor.role))
        throw new operations_schemas_1.OperationError(403, "Solo mando verifica asistencias informadas");
    return (0, transaction_1.serializable)(async (tx) => {
        if (!(await tx.serviceParticipation.updateMany({ where: { id, revision, verifiedAt: null, cancelledAt: null, registeredByUserId: { not: actor.userId } }, data: { verifiedAt: new Date(), revision: { increment: 1 } } })).count)
            throw new operations_schemas_1.OperationError(409, "El registro cambio, ya fue verificado o requiere verificacion independiente");
        await tx.auditLog.create({ data: { actorUserId: actor.userId, action: "SERVICE_ATTENDANCE_VERIFIED", entityType: "ServiceParticipation", entityId: id } });
        return { message: "Asistencia verificada y acreditada" };
    });
}
