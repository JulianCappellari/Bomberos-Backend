"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireQrPresence = requireQrPresence;
const operations_schemas_1 = require("../modules/operations/operations.schemas");
async function requireQrPresence(tx, userId) {
    if (await tx.missionCrew.findFirst({ where: { userId, movement: { returnedAt: null } }, select: { userId: true } }))
        throw new operations_schemas_1.OperationError(403, "Durante una salida a intervencion no puede realizar tareas o controles en el cuartel");
    const presence = await tx.attendance.findFirst({
        where: { userId, status: "OPEN", checkInQrId: { not: null }, checkInAt: { lte: new Date() }, checkInTrust: { not: "REJECTED" } },
        select: { id: true },
    });
    if (!presence)
        throw new operations_schemas_1.OperationError(403, "Debe registrar su ingreso al cuartel mediante QR antes de realizar esta accion");
}
