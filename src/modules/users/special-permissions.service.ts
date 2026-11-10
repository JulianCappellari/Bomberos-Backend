import { serializable } from "../../utils/transaction";
import { OperationError } from "../operations/operations.schemas";
import { notify } from "../members/notifications.service";
import { permissionAllowedForRank, SPECIAL_PERMISSION_LABELS, SpecialPermission } from "../../utils/special-permissions";

// B10/B11: cada permiso se concede o revoca por separado, con motivo, y rige hasta su revocacion.
export async function setSpecialPermission(id: string, permission: SpecialPermission, enabled: boolean, revision: string, reason: string, actor: string) {
  return serializable(async tx => {
    const person = await tx.user.findFirst({ where: { id, deletedAt: null }, include: { profile: true } });
    if (!person || person.updatedAt.toISOString() !== revision) throw new OperationError(409, "El perfil cambió o no existe");
    if (id === actor && enabled) throw new OperationError(403, "Otra persona administradora debe concederle este permiso");
    if (enabled && (!person.isActive || person.isPendingApproval || !permissionAllowedForRank(permission, person.profile?.rank))) throw new OperationError(400, "El cargo o el estado de la cuenta no admite este permiso");
    const before = person.specialPermissions, after = enabled ? [...new Set([...before, permission])] : before.filter(value => value !== permission);
    if (before.length === after.length) return { specialPermissions: before };
    await tx.user.update({ where: { id }, data: { specialPermissions: after, updatedAt: new Date(Math.max(Date.now(), person.updatedAt.getTime() + 1)) } });
    await tx.auditLog.create({ data: { actorUserId: actor, action: enabled ? "SPECIAL_PERMISSION_GRANTED" : "SPECIAL_PERMISSION_REVOKED", entityType: "User", entityId: id, metadata: { permission, before, after, reason } } });
    await notify(tx, [id], `${SPECIAL_PERMISSION_LABELS[permission]}: ${enabled ? "permiso concedido" : "permiso revocado"}`, "/me", reason);
    return { specialPermissions: after };
  });
}
