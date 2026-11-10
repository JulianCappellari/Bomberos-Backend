"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setSpecialPermission = setSpecialPermission;
const transaction_1 = require("../../utils/transaction");
const operations_schemas_1 = require("../operations/operations.schemas");
const notifications_service_1 = require("../members/notifications.service");
const special_permissions_1 = require("../../utils/special-permissions");
// B10/B11: cada permiso se concede o revoca por separado, con motivo, y rige hasta su revocacion.
async function setSpecialPermission(id, permission, enabled, revision, reason, actor) {
    return (0, transaction_1.serializable)(async (tx) => {
        const person = await tx.user.findFirst({ where: { id, deletedAt: null }, include: { profile: true } });
        if (!person || person.updatedAt.toISOString() !== revision)
            throw new operations_schemas_1.OperationError(409, "El perfil cambió o no existe");
        if (id === actor && enabled)
            throw new operations_schemas_1.OperationError(403, "Otra persona administradora debe concederle este permiso");
        if (enabled && (!person.isActive || person.isPendingApproval || !(0, special_permissions_1.permissionAllowedForRank)(permission, person.profile?.rank)))
            throw new operations_schemas_1.OperationError(400, "El cargo o el estado de la cuenta no admite este permiso");
        const before = person.specialPermissions, after = enabled ? [...new Set([...before, permission])] : before.filter(value => value !== permission);
        if (before.length === after.length)
            return { specialPermissions: before };
        await tx.user.update({ where: { id }, data: { specialPermissions: after, updatedAt: new Date(Math.max(Date.now(), person.updatedAt.getTime() + 1)) } });
        await tx.auditLog.create({ data: { actorUserId: actor, action: enabled ? "SPECIAL_PERMISSION_GRANTED" : "SPECIAL_PERMISSION_REVOKED", entityType: "User", entityId: id, metadata: { permission, before, after, reason } } });
        await (0, notifications_service_1.notify)(tx, [id], `${special_permissions_1.SPECIAL_PERMISSION_LABELS[permission]}: ${enabled ? "permiso concedido" : "permiso revocado"}`, "/me", reason);
        return { specialPermissions: after };
    });
}
