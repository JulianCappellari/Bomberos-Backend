"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.closeUserPermanences = closeUserPermanences;
exports.administerAccount = administerAccount;
const bcrypt_1 = __importDefault(require("bcrypt"));
const node_crypto_1 = require("node:crypto");
const transaction_1 = require("../../utils/transaction");
const socket_1 = require("../../config/socket");
const operations_schemas_1 = require("../operations/operations.schemas");
async function closeUserPermanences(tx, userId, actorUserId, reason, archived = false) {
    const now = new Date();
    for (const attendance of await tx.attendance.findMany({ where: { userId, status: "OPEN" } })) {
        if (attendance.checkInAt && attendance.checkInAt > now)
            throw new operations_schemas_1.OperationError(409, "Hay una permanencia con ingreso futuro; requiere revision administrativa");
        await tx.attendance.update({ where: { id: attendance.id }, data: { status: "CLOSED", checkOutAt: now, checkOutTrust: "MEDIUM", workedMinutes: attendance.checkInAt ? Math.max(0, Math.floor((now.getTime() - attendance.checkInAt.getTime()) / 60000)) : 0 } });
        await tx.auditLog.create({ data: { actorUserId, action: archived ? "ATTENDANCE_CLOSED_ON_USER_ARCHIVE" : "ATTENDANCE_CLOSED_ON_USER_PAUSE", entityType: "Attendance", entityId: attendance.id, metadata: { userId, reason } } });
    }
}
async function administerAccount(id, actor, input, remove) {
    if (actor.role !== "ADMIN" || actor.userId === id)
        throw new operations_schemas_1.OperationError(403, "Esta accion requiere otro administrador");
    const initialPassword = remove ? null : (0, node_crypto_1.randomBytes)(24).toString("base64url");
    const passwordHash = initialPassword ? await bcrypt_1.default.hash(initialPassword, 12) : null;
    await (0, transaction_1.serializable)(async (tx) => {
        const row = await tx.user.findFirst({ where: { id, deletedAt: null }, select: { updatedAt: true } });
        if (!row || row.updatedAt.toISOString() !== input.revision)
            throw new operations_schemas_1.OperationError(409, "La cuenta cambio; recargue antes de continuar");
        const now = new Date();
        await tx.user.update({ where: { id }, data: remove ? { deletedAt: now, isActive: false } : { passwordHash: passwordHash, mustChangePassword: true } });
        await tx.authSession.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: now } });
        if (remove) {
            await closeUserPermanences(tx, id, actor.userId, input.reason, true);
            const membership = await tx.controlGroupMember.findUnique({ where: { userId: id } });
            if (membership) {
                await tx.controlGroupMember.delete({ where: { userId: id } });
                await tx.controlGroup.update({ where: { id: membership.groupId }, data: { revision: { increment: 1 } } });
                await tx.auditLog.create({ data: { actorUserId: actor.userId, action: "CONTROL_GROUP_MEMBER_ARCHIVED", entityType: "ControlGroup", entityId: membership.groupId, metadata: { userId: id, reason: input.reason } } });
            }
        }
        await tx.auditLog.create({ data: { actorUserId: actor.userId, action: remove ? "USER_ARCHIVED" : "USER_PASSWORD_RESET", entityType: "User", entityId: id, metadata: { reason: input.reason, sessionsRevoked: true } } });
    });
    (0, socket_1.disconnectUser)(id);
    return { message: remove ? "Cuenta dada de baja; historial conservado" : "Clave temporal generada; cambio obligatorio al ingresar", ...(initialPassword ? { initialPassword } : {}) };
}
