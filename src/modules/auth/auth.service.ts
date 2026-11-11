import { closeOwnerAttendanceForGuard } from "../users/guard-account.service";
import bcrypt from "bcrypt";
import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma";
import { signAccessToken, signRefreshToken, verifyRefreshToken } from "../../utils/jwt";
import { serializable } from "../../utils/transaction";
import { disconnectSession, disconnectUser } from "../../config/socket";
import { LoginResponse, SafeUser } from "./auth.types";
import { effectiveAccessRole, guardFunctionAllowed } from "../../utils/firefighter-ranks";

const dummyHash = bcrypt.hash("invalid-placeholder-never-used", 10);
// Bloqueo por cuenta: tras 5 intentos fallidos seguidos la cuenta queda bloqueada 15 minutos, aunque los
// intentos vengan de distintas IP. El mensaje al usuario es siempre el mismo (no revela si la cuenta existe).
export const MAX_FAILED_LOGINS = 5;
export const LOCK_MINUTES = 15;
export const LOGIN_FAILED_MESSAGE = "Usuario o contraseña incorrectos. Tras 5 intentos fallidos la cuenta se bloquea 15 minutos.";
const deviceLabel = (ua?: string | null) => {
  if (!ua) return "dispositivo desconocido";
  const os = /Android/i.test(ua) ? "Android" : /iPhone|iPad|iOS/i.test(ua) ? "iPhone/iPad" : /Windows/i.test(ua) ? "Windows" : /Mac OS/i.test(ua) ? "Mac" : /Linux/i.test(ua) ? "Linux" : "otro sistema";
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "navegador";
  return `${browser} en ${os}`;
};
async function registerFailedLogin(user: { id: string; failedLoginCount: number }, userAgent?: string) {
  await prisma.$transaction(async (tx) => {
    const updated = await tx.user.update({ where: { id: user.id }, data: { failedLoginCount: { increment: 1 } }, select: { failedLoginCount: true } });
    await tx.auditLog.create({ data: { actorUserId: null, action: "AUTH_LOGIN_FAILED", entityType: "User", entityId: user.id, metadata: { attempt: updated.failedLoginCount, device: deviceLabel(userAgent) } } });
    if (updated.failedLoginCount >= MAX_FAILED_LOGINS) {
      const lockedUntil = new Date(Date.now() + LOCK_MINUTES * 60_000);
      await tx.user.update({ where: { id: user.id }, data: { lockedUntil, failedLoginCount: 0 } });
      await tx.auditLog.create({ data: { actorUserId: null, action: "AUTH_ACCOUNT_LOCKED", entityType: "User", entityId: user.id, metadata: { lockedUntil: lockedUntil.toISOString(), device: deviceLabel(userAgent) } } });
      await tx.memberNotification.create({ data: { userId: user.id, title: "Tu cuenta se bloqueó por intentos fallidos", href: "/me?tab=security", body: `Hubo ${MAX_FAILED_LOGINS} intentos de ingreso con contraseña incorrecta. Si no fuiste vos, cambiá la contraseña y avisá a administración.` } });
      const admins = await tx.user.findMany({ where: { isActive: true, deletedAt: null, OR: [{ role: "ADMIN" }, { profile: { rank: { in: ["Administrador", "Oficial"] } } }], id: { not: user.id } }, select: { id: true } });
      if (admins.length) await tx.memberNotification.createMany({ data: admins.map((a) => ({ userId: a.id, title: "Cuenta bloqueada por intentos fallidos", href: "/security-center", body: `Se bloqueó una cuenta ${LOCK_MINUTES} minutos tras ${MAX_FAILED_LOGINS} intentos fallidos (${deviceLabel(userAgent)}).` })) });
    }
  });
}
export const hashRefreshToken = (token: string) => createHash("sha256").update(token).digest("hex");
type ProfileUser = Prisma.UserGetPayload<{ include: { profile: true } }>;
export function mapSafeUser(user: ProfileUser, sessionRole?: string): SafeUser {
  const primaryRole = effectiveAccessRole(user.role, user.profile?.rank), role = sessionRole || primaryRole;
  return {
    id: user.id, username: user.username, email: user.email, role,
    primaryRole, guardEligible: guardFunctionAllowed(user.guardEligible,user.profile?.rank), accessMode: role === "GUARD" ? "GUARD" : "PERSONAL", specialPermissions: user.specialPermissions,
    isActive: user.isActive, isPendingApproval: user.isPendingApproval, mustChangePassword: user.mustChangePassword,
    profile: user.profile ? { fullName: user.profile.fullName, rank: user.profile.rank, badge: user.profile.badge } : null,
  };
}

export async function loginUser(username: string, password: string, userAgent?: string): Promise<LoginResponse> {
  const user = await prisma.user.findUnique({ where: { username }, include: { profile: true } });
  const matches = await bcrypt.compare(password, user?.passwordHash || await dummyHash);
  // Cuenta bloqueada: ni siquiera la contrasena correcta entra hasta que venza el bloqueo.
  if (user?.lockedUntil && user.lockedUntil > new Date()) {
    await prisma.auditLog.create({ data: { actorUserId: null, action: "AUTH_LOGIN_WHILE_LOCKED", entityType: "User", entityId: user.id, metadata: { device: deviceLabel(userAgent), correctPassword: matches } } });
    throw new Error(LOGIN_FAILED_MESSAGE);
  }
  if (user && !matches && !user.deletedAt) { await registerFailedLogin(user, userAgent); throw new Error(LOGIN_FAILED_MESSAGE); }
  if (!user || !matches || user.deletedAt || !user.isActive || user.isPendingApproval) throw new Error(LOGIN_FAILED_MESSAGE);
  return serializable(async (tx) => {
    const current = await tx.user.findFirst({
      where: { id: user.id, passwordHash: user.passwordHash, deletedAt: null, isActive: true, isPendingApproval: false },
      include: { profile: true },
    });
    if (!current) throw new Error(LOGIN_FAILED_MESSAGE);
    if (current.failedLoginCount || current.lockedUntil) await tx.user.update({ where: { id: current.id }, data: { failedLoginCount: 0, lockedUntil: null } });
    // Ingreso desde un dispositivo que la cuenta no uso en 90 dias: se avisa a su titular.
    const ua = userAgent?.slice(0, 200) || null;
    const known = await tx.authSession.findFirst({ where: { userId: current.id, userAgent: ua, createdAt: { gt: new Date(Date.now() - 90 * 86_400_000) } }, select: { id: true } });
    const hadSessions = await tx.authSession.findFirst({ where: { userId: current.id }, select: { id: true } });
    const sessionId = randomUUID();
    const payload = { userId: current.id, role: current.role, sessionId };
    const accessToken = signAccessToken(payload);
    const refreshToken = signRefreshToken(payload);
    await tx.authSession.create({
      data: {
        id: sessionId, userId: current.id, refreshTokenHash: hashRefreshToken(refreshToken),
        expiresAt: new Date(verifyRefreshToken(refreshToken).exp * 1000), userAgent: userAgent?.slice(0, 200) || null,
      },
    });
    // Cuenta de guardia: al tomar la guardia termina la permanencia personal de su titular.
    await closeOwnerAttendanceForGuard(tx, current);
    await tx.auditLog.create({
      data: { actorUserId: current.id, action: "AUTH_LOGIN", entityType: "AuthSession", entityId: sessionId, metadata: { device: deviceLabel(userAgent) } },
    });
    if (hadSessions && !known) {
      await tx.auditLog.create({ data: { actorUserId: current.id, action: "AUTH_NEW_DEVICE", entityType: "AuthSession", entityId: sessionId, metadata: { device: deviceLabel(userAgent) } } });
      await tx.memberNotification.create({ data: { userId: current.id, title: "Nuevo inicio de sesión", href: "/me?tab=security", body: `Se ingresó a tu cuenta desde ${deviceLabel(userAgent)}. Si no fuiste vos, cerrá las otras sesiones y cambiá la contraseña.` } });
    }
    return { user: mapSafeUser(current), tokens: { accessToken, refreshToken } };
  });
}
export async function refreshUserToken(refreshToken: string) {
  const payload = verifyRefreshToken(refreshToken);
  const previousHash = hashRefreshToken(refreshToken);
  const result = await serializable(async (tx) => {
    const session = await tx.authSession.findUnique({ where: { id: payload.sessionId }, include: { user: true } });
    if (!session || session.userId !== payload.userId || session.revokedAt || session.expiresAt <= new Date() ||
        !session.user.isActive || session.user.isPendingApproval || session.user.deletedAt) return null;
    if (session.refreshTokenHash !== previousHash) {
      await tx.authSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
      await tx.auditLog.create({
        data: { actorUserId: session.userId, action: "AUTH_REFRESH_REPLAY_BLOCKED", entityType: "AuthSession", entityId: session.id },
      });
      return null;
    }
    const nextPayload = { userId: session.userId, role: session.user.role, sessionId: session.id };
    const newRefreshToken = signRefreshToken(nextPayload);
    const changed = await tx.authSession.updateMany({
      where: { id: session.id, refreshTokenHash: previousHash, revokedAt: null },
      data: { refreshTokenHash: hashRefreshToken(newRefreshToken), lastUsedAt: new Date() },
    });
    if (!changed.count) return null;
    return { accessToken: signAccessToken(nextPayload), refreshToken: newRefreshToken };
  });
  if (!result) { disconnectSession(payload.sessionId); throw new Error("Sesion vencida o revocada"); }
  return result;
}
export async function changeUserPassword(userId: string, currentPassword: string, newPassword: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.deletedAt || !user.isActive || user.isPendingApproval ||
      !(await bcrypt.compare(currentPassword, user.passwordHash))) throw new Error("La contrasena actual no es correcta");
  if (currentPassword === newPassword) throw new Error("La nueva contrasena debe ser diferente");
  const passwordHash = await bcrypt.hash(newPassword, 12);
  await serializable(async (tx) => {
    const changed = await tx.user.updateMany({
      where: { id: userId, passwordHash: user.passwordHash }, data: { passwordHash, mustChangePassword: false },
    });
    if (!changed.count) throw new Error("La cuenta cambio. Vuelva a iniciar sesion.");
    await tx.authSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
    await tx.auditLog.create({
      data: { actorUserId: userId, action: "AUTH_PASSWORD_CHANGED", entityType: "User", entityId: userId },
    });
  });
  disconnectUser(userId);
  return { message: "Contrasena actualizada. Inicie sesion nuevamente." };
}
export async function revokeSession(userId: string, sessionId: string) {
  const revoked = await prisma.$transaction(async (tx) => {
    const changed = await tx.authSession.updateMany({
      where: { id: sessionId, userId, revokedAt: null }, data: { revokedAt: new Date() },
    });
    if (changed.count) await tx.auditLog.create({
      data: { actorUserId: userId, action: "AUTH_SESSION_REVOKED", entityType: "AuthSession", entityId: sessionId },
    });
    return changed.count > 0;
  });
  if (revoked) disconnectSession(sessionId);
  return { message: "Sesion cerrada" };
}
export async function revokeOtherSessions(userId: string, currentId: string) {
  const count = await prisma.$transaction(async (tx) => {
    const result = await tx.authSession.updateMany({
      where: { userId, id: { not: currentId }, revokedAt: null }, data: { revokedAt: new Date() },
    });
    await tx.auditLog.create({
      data: { actorUserId: userId, action: "AUTH_OTHER_SESSIONS_REVOKED", entityType: "User", entityId: userId, metadata: { count: result.count } },
    });
    return result.count;
  });
  const active = await prisma.authSession.findMany({ where: { userId, id: { not: currentId } }, select: { id: true } });
  active.forEach((session) => disconnectSession(session.id));
  return { count };
}
export async function listSessions(userId: string, currentId: string) {
  const rows = await prisma.authSession.findMany({
    where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
    select: { id: true, userAgent: true, createdAt: true, lastUsedAt: true, expiresAt: true },
    orderBy: { createdAt: "desc" },
  });
  return rows.map((row) => ({ ...row, isCurrent: row.id === currentId }));
}
