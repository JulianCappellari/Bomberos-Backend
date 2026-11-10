"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const node_crypto_1 = require("node:crypto");
const zod_1 = require("zod");
const role_middleware_1 = require("../../middlewares/role.middleware");
const transaction_1 = require("../../utils/transaction");
const operations_schemas_1 = require("../operations/operations.schemas");
const fleet_schemas_1 = require("./fleet.schemas");
const fleet_service_1 = require("./fleet.service");
const finance_access_1 = require("../../utils/finance-access");
const router = (0, express_1.Router)();
const input = zod_1.z.object({ revision: zod_1.z.number().int().positive(), reason: zod_1.z.string().trim().min(10).max(1000), data: zod_1.z.unknown() }).strict();
const digest = (value) => (0, node_crypto_1.createHash)("sha256").update(JSON.stringify(value)).digest("hex");
router.post("/fuel/:id/correct", (0, role_middleware_1.authorize)("ADMIN", "OPERATOR"), async (req, res) => {
    const id = String(req.params.id), correction = input.parse(req.body), data = fleet_schemas_1.fuelSchema.parse(correction.data), actor = req.user;
    res.status(201).json(await (0, transaction_1.serializable)(async (tx) => {
        const previous = await tx.fuelRecord.findUnique({ where: { operationKey: data.operationKey } });
        if (previous) {
            if (previous.replacesId !== id || previous.createdByUserId !== actor.userId || previous.requestHash !== digest(data) || previous.correctionReason !== correction.reason)
                throw new operations_schemas_1.OperationError(409, "La clave corresponde a otra operación");
            return { id: previous.id, replayed: true };
        }
        const old = await tx.fuelRecord.findUnique({ where: { id } });
        if (!old || old.voidedAt || old.revision !== correction.revision)
            throw new operations_schemas_1.OperationError(409, "La carga cambió o ya fue anulada");
        await tx.fuelRecord.update({ where: { id }, data: { voidedAt: new Date(), voidReason: "Rectificada: " + correction.reason, revision: { increment: 1 } } });
        const replacement = await (0, fleet_service_1.recordFuelIn)(tx, data, actor, old.assetId);
        await tx.fuelRecord.update({ where: { id: replacement.id }, data: { replacesId: id, correctionReason: correction.reason } });
        await tx.auditLog.create({ data: { actorUserId: actor.userId, action: "FUEL_CORRECTED", entityType: "FuelRecord", entityId: id, metadata: { replacementId: replacement.id, reason: correction.reason,
                    before: { assetId: old.assetId, occurredAt: old.occurredAt.toISOString(), volumeMilliliters: old.volumeMilliliters, costCents: old.costCents, odometer: old.odometer, reason: old.reason, notes: old.notes },
                    after: { assetId: data.assetId, occurredAt: data.occurredAt, volumeMilliliters: data.liters, costCents: data.costCents ?? null, odometer: data.odometer ?? null, reason: data.reason, notes: data.notes } } } });
        return { id: replacement.id, replayed: false };
    }));
});
router.post("/water/:id/correct", (0, role_middleware_1.authorize)("ADMIN", "OPERATOR"), async (req, res) => {
    const id = String(req.params.id), correction = input.parse(req.body), data = fleet_schemas_1.waterSchema.parse(correction.data), actor = req.user;
    res.status(201).json(await (0, transaction_1.serializable)(async (tx) => {
        const previous = await tx.waterTrip.findUnique({ where: { operationKey: data.operationKey } });
        if (previous) {
            if (previous.replacesId !== id || previous.createdByUserId !== actor.userId || previous.requestHash !== digest(data) || previous.correctionReason !== correction.reason)
                throw new operations_schemas_1.OperationError(409, "La clave corresponde a otra operación");
            return { id: previous.id, replayed: true };
        }
        const old = await tx.waterTrip.findUnique({ where: { id }, include: { crew: true } });
        if (!old || old.voidedAt || old.revision !== correction.revision)
            throw new operations_schemas_1.OperationError(409, "El viaje cambió o ya fue anulado");
        if (old.earningsApprovedAt && !(await (0, finance_access_1.financeAccess)(actor.userId, actor.role)).canManage)
            throw new operations_schemas_1.OperationError(403, "Solo acceso financiero puede rectificar un viaje con deuda reconocida");
        if (old.clientPaidAt || old.crew.some(m => m.paidAt))
            throw new operations_schemas_1.OperationError(409, "Revierta primero las constancias de cobro y pago");
        await tx.waterTrip.update({ where: { id }, data: { voidedAt: new Date(), voidReason: "Rectificado: " + correction.reason, revision: { increment: 1 } } });
        const replacement = await (0, fleet_service_1.recordWaterIn)(tx, data, actor, { assetId: old.assetId, userIds: old.crew.map(m => m.userId) });
        await tx.waterTrip.update({ where: { id: replacement.id }, data: { replacesId: id, correctionReason: correction.reason } });
        const { operationKey: _, ...after } = data;
        await tx.auditLog.create({ data: { actorUserId: actor.userId, action: "WATER_TRIP_CORRECTED", entityType: "WaterTrip", entityId: id, metadata: { replacementId: replacement.id, reason: correction.reason,
                    before: { assetId: old.assetId, customer: old.customer, destination: old.destination, departedAt: old.departedAt.toISOString(), returnedAt: old.returnedAt.toISOString(), startOdometer: old.startOdometer, endOdometer: old.endOdometer, tripCount: old.tripCount, chargeCents: old.chargeCents, leaderUserId: old.leaderUserId, notes: old.notes, crew: old.crew.map(m => ({ userId: m.userId, compensationCents: m.compensationCents })) }, after } } });
        return { id: replacement.id, replayed: false };
    }));
});
exports.default = router;
