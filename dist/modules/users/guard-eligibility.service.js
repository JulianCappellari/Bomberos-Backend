"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setGuardEligibility = setGuardEligibility;
const transaction_1 = require("../../utils/transaction");
const firefighter_ranks_1 = require("../../utils/firefighter-ranks");
const operations_schemas_1 = require("../operations/operations.schemas");
const notifications_service_1 = require("../members/notifications.service");
async function setGuardEligibility(id, enabled, revision, reason, actor) {
    return (0, transaction_1.serializable)(async (tx) => {
        const person = await tx.user.findFirst({ where: { id, deletedAt: null }, include: { profile: true } });
        if (!person || person.updatedAt.toISOString() !== revision)
            throw new operations_schemas_1.OperationError(409, "El perfil cambió o no existe");
        if (enabled && (!person.isActive || person.isPendingApproval || !(0, firefighter_ranks_1.guardFunctionAllowed)(true, person.profile?.rank)))
            throw new operations_schemas_1.OperationError(400, "Seleccione personal operativo activo con cargo Bombero, Oficial o Sub oficial");
        if (id === actor && enabled)
            throw new operations_schemas_1.OperationError(403, "Otra persona administradora debe habilitar su función de guardia");
        await tx.user.update({ where: { id }, data: { guardEligible: enabled } });
        if (!enabled)
            await tx.authSession.updateMany({ where: { userId: id, guardMode: true }, data: { guardMode: false } });
        await tx.auditLog.create({ data: { actorUserId: actor, action: enabled ? "GUARD_FUNCTION_GRANTED" : "GUARD_FUNCTION_REVOKED", entityType: "User", entityId: id, metadata: { before: person.guardEligible, after: enabled, reason } } });
        await (0, notifications_service_1.notify)(tx, [id], enabled ? "Función de guardia habilitada" : "Función de guardia revocada", "/me", reason);
        return { guardEligible: enabled };
    });
}
