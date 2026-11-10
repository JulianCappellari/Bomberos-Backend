"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.personalActivity = personalActivity;
const transaction_1 = require("../../utils/transaction");
const operations_schemas_1 = require("../operations/operations.schemas");
async function personalActivity(userId, kind, page, actor) {
    if (actor.userId !== userId && actor.role !== "ADMIN")
        throw new operations_schemas_1.OperationError(403, "Solo puede consultar su propia actividad; la ajena queda reservada a administracion y oficiales");
    return (0, transaction_1.serializable)(async (tx) => {
        if (actor.userId !== userId)
            await tx.auditLog.create({ data: { actorUserId: actor.userId, action: "PERSONAL_ACTIVITY_VIEWED", entityType: "User", entityId: userId, metadata: { kind, page } } });
        const pagination = { skip: (page - 1) * 20, take: 20, orderBy: { id: "desc" } };
        if (kind === "ATTENDANCE") {
            const items = await tx.attendance.findMany({ where: { userId }, ...pagination, select: { id: true, checkInAt: true, checkOutAt: true, status: true, workedMinutes: true, discardedAt: true } });
            return { page, total: await tx.attendance.count({ where: { userId } }), items: items.map((r) => ({ id: r.id, date: r.checkInAt, title: "Permanencia en cuartel", status: r.status, detail: r.discardedAt ? "Descartada por cierre automático sin revalidación: no acredita horas ni puntos" : r.checkOutAt ? `Salida: ${r.checkOutAt.toISOString()} - ${r.workedMinutes || 0} min` : "Permanencia abierta" })) };
        }
        if (kind === "SHIFT") {
            const items = await tx.shiftAssignment.findMany({ where: { userId }, ...pagination, select: { id: true, shift: { select: { date: true, shiftType: true, startTime: true, endTime: true } } } });
            return { page, total: await tx.shiftAssignment.count({ where: { userId } }), items: items.map((r) => ({ id: r.id, date: r.shift.date, dateOnly: true, title: r.shift.shiftType, status: "Asignacion", detail: `${r.shift.startTime} - ${r.shift.endTime}; no acredita asistencia por si sola` })) };
        }
        if (kind === "INCIDENT") {
            const items = await tx.incidentAssignment.findMany({ where: { userId }, ...pagination, select: { id: true, incident: { select: { title: true, occurredAt: true, status: true } } } });
            return { page, total: await tx.incidentAssignment.count({ where: { userId } }), items: items.map((r) => ({ id: r.id, date: r.incident.occurredAt, title: r.incident.title, status: r.incident.status, detail: "Asignacion a emergencia; la asistencia efectiva se verifica por separado" })) };
        }
        if (kind === "INSPECTION") {
            const items = await tx.inspectionResponsible.findMany({ where: { userId }, ...pagination, select: { id: true, inspection: { select: { inspectionDate: true, voidedAt: true, resultingAssetStatus: true } } } });
            return { page, total: await tx.inspectionResponsible.count({ where: { userId } }), items: items.map((r) => ({ id: r.id, date: r.inspection.inspectionDate, dateOnly: true, title: "Control vehicular", status: r.inspection.voidedAt ? "Anulado" : r.inspection.resultingAssetStatus || "Registrado", detail: "Participante registrado en la planilla" })) };
        }
        const items = await tx.workTaskMember.findMany({ where: { userId }, skip: pagination.skip, take: pagination.take, orderBy: [{ task: { updatedAt: "desc" } }, { taskId: "desc" }], select: { taskId: true, declinedAt: true, task: { select: { title: true, updatedAt: true, status: true } } } });
        return { page, total: await tx.workTaskMember.count({ where: { userId } }), items: items.map((r) => ({ id: r.taskId, date: r.task.updatedAt, title: r.task.title, status: r.task.status, detail: r.declinedAt ? "Participacion declinada" : "Integrante del equipo de trabajo" })) };
    });
}
