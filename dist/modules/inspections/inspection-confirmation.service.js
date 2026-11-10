"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SIGN_WINDOW_MS = void 0;
exports.hasMajority = hasMajority;
exports.removeInspectionParticipant = removeInspectionParticipant;
exports.confirmInspection = confirmInspection;
const transaction_1 = require("../../utils/transaction");
const operations_schemas_1 = require("../operations/operations.schemas");
const inspections_rules_1 = require("./inspections.rules");
const notifications_service_1 = require("../members/notifications.service");
const inspection_presence_1 = require("./inspection-presence");
exports.SIGN_WINDOW_MS = 24 * 3600000;
function hasMajority(signed, total) { return signed * 2 > total; }
// H09: retirar a quien fue incluido por error o niega haber participado; el control se recalcula con nueva version.
async function removeInspectionParticipant(id, userId, input, actor) {
    if (!["ADMIN", "OPERATOR"].includes(actor.role))
        throw new operations_schemas_1.OperationError(403, "Solo jefatura retira participantes de un control");
    return (0, transaction_1.serializable)(async (tx) => {
        await tx.$queryRaw `SELECT "id" FROM "Inspection" WHERE "id" = ${id} FOR UPDATE`;
        const row = await tx.inspection.findUnique({ where: { id }, include: { responsibles: true, vehicle: { include: { asset: true } } } });
        if (!row || row.voidedAt || row.revision !== input.revision)
            throw new operations_schemas_1.OperationError(409, "El control cambió, fue anulado o no existe");
        const target = row.responsibles.find(member => member.userId === userId);
        if (!target)
            throw new operations_schemas_1.OperationError(404, "La persona no figura en el control");
        if (target.confirmedAt)
            throw new operations_schemas_1.OperationError(409, "La persona ya firmó su participación; use la rectificación del control");
        if (row.responsibles.length === 1 || userId === row.createdByUserId)
            throw new operations_schemas_1.OperationError(409, "No puede retirarse al autor ni dejar el control sin participantes");
        await tx.inspectionResponsible.delete({ where: { inspectionId_userId: { inspectionId: id, userId } } });
        const rest = row.responsibles.filter(member => member.userId !== userId), signed = rest.filter(member => member.confirmedAt).length, complete = signed === rest.length;
        await tx.inspection.update({ where: { id }, data: { revision: { increment: 1 }, confirmationsComplete: complete, ...(row.leaderUserId === userId ? { leaderUserId: row.createdByUserId } : {}) } });
        if ((complete || hasMajority(signed, rest.length)) && row.vehicle.asset.status !== "OUT_OF_SERVICE") {
            const latest = await tx.inspection.findFirst({ where: { vehicleId: row.vehicleId, voidedAt: null }, orderBy: [{ inspectionDate: "desc" }, { inspectionTime: "desc" }, { createdAt: "desc" }] });
            const blocking = await tx.maintenanceJob.findFirst({ where: { assetId: row.vehicle.assetId, blocksOperation: true, status: { in: ["OPEN", "IN_PROGRESS"] } } });
            if (latest?.id === id)
                await tx.asset.update({ where: { id: row.vehicle.assetId }, data: { status: blocking ? "MAINTENANCE" : row.resultingAssetStatus || "MAINTENANCE" } });
        }
        await tx.auditLog.create({ data: { actorUserId: actor.userId, action: "INSPECTION_PARTICIPANT_REMOVED", entityType: "Inspection", entityId: id, metadata: { userId, reason: input.reason, previousRevision: row.revision, revision: row.revision + 1, complete } } });
        await (0, notifications_service_1.notify)(tx, [userId, ...rest.map(member => member.userId)], "Control vehicular: participante retirado", `/equipment/${row.vehicle.assetId}/history`, input.reason);
        return { complete, revision: row.revision + 1 };
    });
}
async function confirmInspection(id, userId) {
    return (0, transaction_1.serializable)(async (tx) => {
        await tx.$queryRaw `SELECT "id" FROM "Inspection" WHERE "id" = ${id} FOR UPDATE`;
        const row = await tx.inspection.findUnique({ where: { id }, include: { responsibles: true, vehicle: { include: { asset: true } } } });
        if (!row || row.voidedAt)
            throw new operations_schemas_1.OperationError(404, "Control no disponible");
        const own = row.responsibles.find(member => member.userId === userId);
        if (!own)
            throw new operations_schemas_1.OperationError(403, "Solo puede confirmar controles en los que figura como participante");
        if (row.confirmationsComplete || own.confirmedAt)
            return { complete: row.confirmationsComplete };
        // H08: cada participante tiene 24 horas para firmar; despues jefatura debe retirarlo (H09).
        if (Date.now() > row.createdAt.getTime() + exports.SIGN_WINDOW_MS)
            throw new operations_schemas_1.OperationError(409, "Venció el plazo de 24 horas para firmar. Jefatura debe retirar su participación para completar el control");
        await (0, inspection_presence_1.requireInspectionPresence)(tx, userId, own.participatedAt ? +own.participatedAt : (0, inspections_rules_1.inspectionTimestamp)(row.inspectionDate.toISOString().slice(0, 10), row.inspectionTime || "00:00"));
        await tx.inspectionResponsible.update({ where: { inspectionId_userId: { inspectionId: id, userId } }, data: { confirmedAt: new Date() } });
        const complete = row.responsibles.every(member => member.userId === userId || member.confirmedAt);
        const signed = row.responsibles.filter(member => member.userId === userId || member.confirmedAt).length;
        // H11: con la mayoria de las firmas el movil queda certificado para salir; el control se completa con todas (H07).
        if (complete || hasMajority(signed, row.responsibles.length)) {
            if (complete)
                await tx.inspection.update({ where: { id }, data: { confirmationsComplete: true } });
            const latest = await tx.inspection.findFirst({ where: { vehicleId: row.vehicleId, voidedAt: null }, orderBy: [{ inspectionDate: "desc" }, { inspectionTime: "desc" }, { createdAt: "desc" }] });
            const blocking = await tx.maintenanceJob.findFirst({ where: { assetId: row.vehicle.assetId, blocksOperation: true, status: { in: ["OPEN", "IN_PROGRESS"] } } });
            const closed = await tx.maintenanceJob.findFirst({ where: { assetId: row.vehicle.assetId, blocksOperation: true, resolvedAt: { not: null } }, orderBy: { resolvedAt: "desc" } });
            const needsRecheck = closed?.resolvedAt && (0, inspections_rules_1.inspectionTimestamp)(row.inspectionDate.toISOString().slice(0, 10), row.inspectionTime || "00:00") < closed.resolvedAt.getTime();
            if (latest?.id === id && row.vehicle.asset.status !== "OUT_OF_SERVICE")
                await tx.asset.update({ where: { id: row.vehicle.assetId }, data: { status: blocking || needsRecheck ? "MAINTENANCE" : row.resultingAssetStatus || "MAINTENANCE" } });
            if (complete)
                await (0, notifications_service_1.notify)(tx, row.responsibles.map(member => member.userId), "Control vehicular confirmado por todo el equipo", `/equipment/${row.vehicle.assetId}/history`);
        }
        await tx.auditLog.create({ data: { actorUserId: userId, action: "INSPECTION_PARTICIPATION_CONFIRMED", entityType: "Inspection", entityId: id, metadata: { complete } } });
        return { complete };
    });
}
