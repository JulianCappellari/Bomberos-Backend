"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.hashRefreshToken = void 0;
exports.mapSafeUser = mapSafeUser;
exports.loginUser = loginUser;
exports.refreshUserToken = refreshUserToken;
exports.changeUserPassword = changeUserPassword;
exports.revokeSession = revokeSession;
exports.revokeOtherSessions = revokeOtherSessions;
exports.listSessions = listSessions;
const bcrypt_1 = __importDefault(require("bcrypt"));
const node_crypto_1 = require("node:crypto");
const prisma_1 = require("../../config/prisma");
const jwt_1 = require("../../utils/jwt");
const transaction_1 = require("../../utils/transaction");
const socket_1 = require("../../config/socket");
const firefighter_ranks_1 = require("../../utils/firefighter-ranks");
const dummyHash = bcrypt_1.default.hash("invalid-placeholder-never-used", 10);
const hashRefreshToken = (token) => (0, node_crypto_1.createHash)("sha256").update(token).digest("hex");
exports.hashRefreshToken = hashRefreshToken;
function mapSafeUser(user, sessionRole) {
    const primaryRole = (0, firefighter_ranks_1.effectiveAccessRole)(user.role, user.profile?.rank), role = sessionRole || primaryRole;
    return {
        id: user.id, username: user.username, email: user.email, role,
        primaryRole, guardEligible: (0, firefighter_ranks_1.guardFunctionAllowed)(user.guardEligible, user.profile?.rank), accessMode: role === "GUARD" ? "GUARD" : "PERSONAL", specialPermissions: user.specialPermissions,
        isActive: user.isActive, isPendingApproval: user.isPendingApproval, mustChangePassword: user.mustChangePassword,
        profile: user.profile ? { fullName: user.profile.fullName, rank: user.profile.rank, badge: user.profile.badge } : null,
    };
}
async function loginUser(username, password, userAgent) {
    const user = await prisma_1.prisma.user.findUnique({ where: { username }, include: { profile: true } });
    const matches = await bcrypt_1.default.compare(password, user?.passwordHash || await dummyHash);
    if (!user || !matches || user.deletedAt || !user.isActive || user.isPendingApproval)
        throw new Error("Usuario o contraseña incorrectos");
    return (0, transaction_1.serializable)(async (tx) => {
        const current = await tx.user.findFirst({
            where: { id: user.id, passwordHash: user.passwordHash, deletedAt: null, isActive: true, isPendingApproval: false },
            include: { profile: true },
        });
        if (!current)
            throw new Error("Usuario o contraseña incorrectos");
        const sessionId = (0, node_crypto_1.randomUUID)();
        const payload = { userId: current.id, role: current.role, sessionId };
        const accessToken = (0, jwt_1.signAccessToken)(payload);
        const refreshToken = (0, jwt_1.signRefreshToken)(payload);
        await tx.authSession.create({
            data: {
                id: sessionId, userId: current.id, refreshTokenHash: (0, exports.hashRefreshToken)(refreshToken),
                expiresAt: new Date((0, jwt_1.verifyRefreshToken)(refreshToken).exp * 1000), userAgent: userAgent?.slice(0, 200) || null,
            },
        });
        await tx.auditLog.create({
            data: { actorUserId: current.id, action: "AUTH_LOGIN", entityType: "AuthSession", entityId: sessionId },
        });
        return { user: mapSafeUser(current), tokens: { accessToken, refreshToken } };
    });
}
async function refreshUserToken(refreshToken) {
    const payload = (0, jwt_1.verifyRefreshToken)(refreshToken);
    const previousHash = (0, exports.hashRefreshToken)(refreshToken);
    const result = await (0, transaction_1.serializable)(async (tx) => {
        const session = await tx.authSession.findUnique({ where: { id: payload.sessionId }, include: { user: true } });
        if (!session || session.userId !== payload.userId || session.revokedAt || session.expiresAt <= new Date() ||
            !session.user.isActive || session.user.isPendingApproval || session.user.deletedAt)
            return null;
        if (session.refreshTokenHash !== previousHash) {
            await tx.authSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
            await tx.auditLog.create({
                data: { actorUserId: session.userId, action: "AUTH_REFRESH_REPLAY_BLOCKED", entityType: "AuthSession", entityId: session.id },
            });
            return null;
        }
        const nextPayload = { userId: session.userId, role: session.user.role, sessionId: session.id };
        const newRefreshToken = (0, jwt_1.signRefreshToken)(nextPayload);
        const changed = await tx.authSession.updateMany({
            where: { id: session.id, refreshTokenHash: previousHash, revokedAt: null },
            data: { refreshTokenHash: (0, exports.hashRefreshToken)(newRefreshToken), lastUsedAt: new Date() },
        });
        if (!changed.count)
            return null;
        return { accessToken: (0, jwt_1.signAccessToken)(nextPayload), refreshToken: newRefreshToken };
    });
    if (!result) {
        (0, socket_1.disconnectSession)(payload.sessionId);
        throw new Error("Sesion vencida o revocada");
    }
    return result;
}
async function changeUserPassword(userId, currentPassword, newPassword) {
    const user = await prisma_1.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.deletedAt || !user.isActive || user.isPendingApproval ||
        !(await bcrypt_1.default.compare(currentPassword, user.passwordHash)))
        throw new Error("La contrasena actual no es correcta");
    if (currentPassword === newPassword)
        throw new Error("La nueva contrasena debe ser diferente");
    const passwordHash = await bcrypt_1.default.hash(newPassword, 12);
    await (0, transaction_1.serializable)(async (tx) => {
        const changed = await tx.user.updateMany({
            where: { id: userId, passwordHash: user.passwordHash }, data: { passwordHash, mustChangePassword: false },
        });
        if (!changed.count)
            throw new Error("La cuenta cambio. Vuelva a iniciar sesion.");
        await tx.authSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
        await tx.auditLog.create({
            data: { actorUserId: userId, action: "AUTH_PASSWORD_CHANGED", entityType: "User", entityId: userId },
        });
    });
    (0, socket_1.disconnectUser)(userId);
    return { message: "Contrasena actualizada. Inicie sesion nuevamente." };
}
async function revokeSession(userId, sessionId) {
    const revoked = await prisma_1.prisma.$transaction(async (tx) => {
        const changed = await tx.authSession.updateMany({
            where: { id: sessionId, userId, revokedAt: null }, data: { revokedAt: new Date() },
        });
        if (changed.count)
            await tx.auditLog.create({
                data: { actorUserId: userId, action: "AUTH_SESSION_REVOKED", entityType: "AuthSession", entityId: sessionId },
            });
        return changed.count > 0;
    });
    if (revoked)
        (0, socket_1.disconnectSession)(sessionId);
    return { message: "Sesion cerrada" };
}
async function revokeOtherSessions(userId, currentId) {
    const count = await prisma_1.prisma.$transaction(async (tx) => {
        const result = await tx.authSession.updateMany({
            where: { userId, id: { not: currentId }, revokedAt: null }, data: { revokedAt: new Date() },
        });
        await tx.auditLog.create({
            data: { actorUserId: userId, action: "AUTH_OTHER_SESSIONS_REVOKED", entityType: "User", entityId: userId, metadata: { count: result.count } },
        });
        return result.count;
    });
    const active = await prisma_1.prisma.authSession.findMany({ where: { userId, id: { not: currentId } }, select: { id: true } });
    active.forEach((session) => (0, socket_1.disconnectSession)(session.id));
    return { count };
}
async function listSessions(userId, currentId) {
    const rows = await prisma_1.prisma.authSession.findMany({
        where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
        select: { id: true, userAgent: true, createdAt: true, lastUsedAt: true, expiresAt: true },
        orderBy: { createdAt: "desc" },
    });
    return rows.map((row) => ({ ...row, isCurrent: row.id === currentId }));
}
