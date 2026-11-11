"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.canWriteIncident = canWriteIncident;
exports.requireIncidentWrite = requireIncidentWrite;
const require_qr_presence_1 = require("../../utils/require-qr-presence");
// Authentication resolves both the administrator and official to ADMIN.
// Writing a report does not certify attendance or change an alert response.
async function canWriteIncident(tx, actor) {
    if (actor.role === "ADMIN")
        return true;
    return Boolean(await tx.attendance.findFirst({ where: {
            userId: actor.userId, status: "OPEN", checkInQrId: { not: null }, checkInAt: { lte: new Date() }, checkInTrust: { not: "REJECTED" },
            user: { missionCrew: { none: { movement: { returnedAt: null } } } },
        }, select: { id: true } }));
}
async function requireIncidentWrite(tx, actor) {
    if (actor.role !== "ADMIN")
        await (0, require_qr_presence_1.requireQrPresence)(tx, actor.userId);
}
