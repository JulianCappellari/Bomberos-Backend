"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.financeAccess = financeAccess;
const prisma_1 = require("../config/prisma");
const firefighter_ranks_1 = require("./firefighter-ranks");
// O01/O06: gestionan finanzas el administrador general, el oficial designado jefe financiero
// y quien tenga el permiso especial FINANCE (oficial o integrante de comision directiva designado).
async function financeAccess(userId, role) {
    const u = await prisma_1.prisma.user.findUnique({ where: { id: userId }, select: { financeChief: true, specialPermissions: true, isActive: true, deletedAt: true, profile: { select: { rank: true } } } });
    const rank = (0, firefighter_ranks_1.normalizeRank)(u?.profile?.rank).replace(/\s/g, ""), active = Boolean(u?.isActive && !u.deletedAt);
    const delegate = active && role === "ADMIN" && rank === "administrador";
    const designated = active && (role === "ADMIN" && rank === "oficial" && Boolean(u?.financeChief) || role !== "GUARD" && Boolean(u?.specialPermissions.includes("FINANCE")) && ["oficial", "comisiondirectiva"].includes(rank));
    return { canDelegate: delegate, canManage: delegate || designated };
}
