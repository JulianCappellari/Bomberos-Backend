"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.amendInspection = amendInspection;
const transaction_1 = require("../../utils/transaction");
const operations_schemas_1 = require("../operations/operations.schemas");
async function amendInspection(id, actor, input, voiding) {
    if (!["ADMIN", "OPERATOR"].includes(actor.role))
        throw new operations_schemas_1.OperationError(403, "Solo administracion, oficiales y suboficiales corrigen o anulan controles");
    return (0, transaction_1.serializable)(async (tx) => {
        const row = await tx.inspection.findUnique({ where: { id }, include: { vehicle: true } });
        if (!row || row.voidedAt)
            throw new operations_schemas_1.OperationError(409, "Control no encontrado o anulado");
        const result = await tx.inspection.updateMany({ where: { id, revision: input.revision, voidedAt: null }, data: voiding ? { voidedAt: new Date(), voidReason: input.reason, revision: { increment: 1 } } : { amendment: input.amendment, revision: { increment: 1 } } });
        if (!result.count)
            throw new operations_schemas_1.OperationError(409, "El control cambio; recargue antes de continuar");
        if (voiding)
            await tx.asset.updateMany({ where: { id: row.vehicle.assetId, status: { not: "OUT_OF_SERVICE" } }, data: { status: "MAINTENANCE" } });
        await tx.auditLog.create({ data: { actorUserId: actor.userId, action: voiding ? "INSPECTION_VOIDED" : "INSPECTION_AMENDED", entityType: "Inspection", entityId: id, metadata: { reason: input.reason, before: { amendment: row.amendment, voidedAt: null, revision: row.revision }, after: { amendment: input.amendment || row.amendment, voided: voiding, revision: row.revision + 1 }, requiresPhysicalReview: voiding } } });
        return tx.inspection.findUniqueOrThrow({ where: { id } });
    });
}
