"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.voidAndRedoIncident = voidAndRedoIncident;
const transaction_1 = require("../../utils/transaction");
const operations_schemas_1 = require("../operations/operations.schemas");
const notifications_service_1 = require("../members/notifications.service");
// G15: la intervencion cerrada queda anulada (con su acta de salida y sus creditos) y se abre una
// nueva que la reemplaza, donde se vuelven a cargar dotaciones, horarios y planilla.
async function voidAndRedoIncident(id, reason, actorUserId) {
    return (0, transaction_1.serializable)(async (tx) => {
        await tx.$queryRaw `SELECT "id" FROM "Incident" WHERE "id" = ${id} FOR UPDATE`;
        const incident = await tx.incident.findUnique({ where: { id }, include: { movements: { select: { departureId: true } }, replacement: { select: { id: true } } } });
        if (!incident)
            throw new operations_schemas_1.OperationError(404, "Intervención no encontrada");
        if (incident.status !== "CLOSED")
            throw new operations_schemas_1.OperationError(409, "Solo una intervención cerrada se anula y rehace; si está abierta, corríjala en su planilla");
        if (incident.voidedAt || incident.replacement)
            throw new operations_schemas_1.OperationError(409, "La intervención ya fue anulada");
        const now = new Date();
        const departureIds = incident.movements.flatMap(m => m.departureId ? [m.departureId] : []);
        if (departureIds.length)
            await tx.vehicleDeparture.updateMany({ where: { id: { in: departureIds }, voidedAt: null }, data: { voidedAt: now, voidReason: `Intervención anulada para rehacer: ${reason}`.slice(0, 2000), revision: { increment: 1 } } });
        await tx.serviceParticipation.updateMany({ where: { incidentId: id, cancelledAt: null }, data: { cancelledAt: now, cancelReason: `Intervención anulada para rehacer: ${reason}`.slice(0, 2000), revision: { increment: 1 } } });
        await tx.incident.update({ where: { id }, data: { voidedAt: now, voidReason: reason } });
        const redo = await tx.incident.create({ data: { title: incident.title, type: incident.type, description: incident.description, location: incident.location, occurredAt: incident.occurredAt, createdByUserId: actorUserId, replacesIncidentId: id } });
        await tx.auditLog.create({ data: { actorUserId, action: "INCIDENT_VOIDED_FOR_REDO", entityType: "Incident", entityId: id, metadata: { reason, replacementIncidentId: redo.id, voidedDepartures: departureIds } } });
        await (0, notifications_service_1.notifyCommand)(tx, `Intervención anulada para rehacer: ${incident.title}`, `/incidents/${redo.id}/sheet`, reason, actorUserId);
        return { voidedIncidentId: id, incidentId: redo.id, message: "Intervención anulada. Se abrió una nueva para cargar todo nuevamente con los horarios reales" };
    });
}
