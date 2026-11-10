"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.authenticateAccessToken = authenticateAccessToken;
const prisma_1 = require("../config/prisma");
const jwt_1 = require("./jwt");
const firefighter_ranks_1 = require("./firefighter-ranks");
async function authenticateAccessToken(token) {
    const payload = (0, jwt_1.verifyAccessToken)(token);
    const session = await prisma_1.prisma.authSession.findFirst({
        where: { id: payload.sessionId, userId: payload.userId, revokedAt: null, expiresAt: { gt: new Date() } },
        select: {
            id: true,
            guardMode: true,
            user: { select: { id: true, role: true, guardEligible: true, specialPermissions: true, profile: { select: { rank: true } }, isActive: true, isPendingApproval: true, deletedAt: true, mustChangePassword: true } },
        },
    });
    if (!session || !session.user.isActive || session.user.isPendingApproval || session.user.deletedAt)
        throw new Error("Session unavailable");
    return {
        userId: session.user.id, role: session.guardMode && (0, firefighter_ranks_1.guardFunctionAllowed)(session.user.guardEligible, session.user.profile?.rank) ? "GUARD" : (0, firefighter_ranks_1.effectiveAccessRole)(session.user.role, session.user.profile?.rank), sessionId: session.id,
        rank: session.user.profile?.rank || null, permissions: session.user.specialPermissions, mustChangePassword: session.user.mustChangePassword, tokenExpiresAt: payload.exp * 1000,
    };
}
