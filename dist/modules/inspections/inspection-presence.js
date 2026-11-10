"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireInspectionPresence = requireInspectionPresence;
const operations_schemas_1 = require("../operations/operations.schemas");
async function requireInspectionPresence(tx, userId, timestamp) {
    // Inspection forms record minutes, so a QR entry in that same minute is admissible.
    const start = new Date(timestamp), end = new Date(timestamp + 60000);
    const presence = await tx.attendance.findFirst({ where: { userId, checkInQrId: { not: null }, checkInAt: { lt: end }, checkInTrust: { not: "REJECTED" }, OR: [{ status: "OPEN" }, { checkOutAt: { gte: start }, checkOutTrust: { not: "REJECTED" } }] }, select: { id: true } });
    const away = await tx.missionCrew.findFirst({ where: { userId, movement: { departedAt: { lte: start }, OR: [{ returnedAt: null }, { returnedAt: { gte: end } }] } }, select: { userId: true } });
    if (!presence || away)
        throw new operations_schemas_1.OperationError(403, "No consta presencia QR en la fecha y minuto del control, o estaba desplegado");
}
