import { prisma } from "../config/prisma";
import { verifyAccessToken } from "./jwt";
import { effectiveAccessRole, guardFunctionAllowed } from "./firefighter-ranks";

export async function authenticateAccessToken(token: string) {
  const payload = verifyAccessToken(token);
  const session = await prisma.authSession.findFirst({
    where: { id: payload.sessionId, userId: payload.userId, revokedAt: null, expiresAt: { gt: new Date() } },
    select: {
      id: true,
      guardMode: true,
      user: { select: { id: true, role: true, guardEligible: true, specialPermissions: true, profile: { select: { rank: true } }, isActive: true, isPendingApproval: true, deletedAt: true, mustChangePassword: true } },
    },
  });
  if (!session || !session.user.isActive || session.user.isPendingApproval || session.user.deletedAt) throw new Error("Session unavailable");
  return {
    userId: session.user.id, role: session.guardMode && guardFunctionAllowed(session.user.guardEligible,session.user.profile?.rank) ? "GUARD" : effectiveAccessRole(session.user.role, session.user.profile?.rank), sessionId: session.id,
    rank: session.user.profile?.rank || null, permissions: session.user.specialPermissions, mustChangePassword: session.user.mustChangePassword, tokenExpiresAt: payload.exp * 1000,
  };
}
