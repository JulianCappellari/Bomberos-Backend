"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const firefighter_ranks_1 = require("../../utils/firefighter-ranks");
const transaction_1 = require("../../utils/transaction");
const operations_schemas_1 = require("../operations/operations.schemas");
const auth_controller_1 = require("./auth.controller");
const auth_middleware_1 = require("../../middlewares/auth.middleware");
const rate_limit_middleware_1 = require("../../middlewares/rate-limit.middleware");
const auth_service_1 = require("./auth.service");
const prisma_1 = require("../../config/prisma");
const router = (0, express_1.Router)();
const authRateLimit = (0, rate_limit_middleware_1.rateLimit)({
    windowMs: 60000,
    maxRequests: 10,
    message: "Demasiados intentos. Probá nuevamente en un minuto.",
});
router.post("/login", authRateLimit, auth_controller_1.loginController);
router.post("/refresh", (0, rate_limit_middleware_1.rateLimit)({ windowMs: 60000, maxRequests: 60 }), auth_controller_1.refreshTokenController);
router.patch("/change-password", auth_middleware_1.authenticate, (0, rate_limit_middleware_1.rateLimit)({ windowMs: 60000, maxRequests: 5 }), auth_controller_1.changePasswordController);
router.get("/me", auth_middleware_1.authenticate, async (req, res) => {
    const user = await prisma_1.prisma.user.findUniqueOrThrow({ where: { id: req.user.userId }, include: { profile: true } });
    res.json((0, auth_service_1.mapSafeUser)(user, req.user.role));
});
router.post("/access-mode", auth_middleware_1.authenticate, (0, rate_limit_middleware_1.rateLimit)({ windowMs: 60000, maxRequests: 10 }), async (req, res) => {
    const { mode } = zod_1.z.object({ mode: zod_1.z.enum(["PERSONAL", "GUARD"]) }).strict().parse(req.body);
    res.json(await (0, transaction_1.serializable)(async (tx) => {
        const user = await tx.user.findUniqueOrThrow({ where: { id: req.user.userId }, include: { profile: true } });
        if (user.mustChangePassword)
            throw new operations_schemas_1.OperationError(403, "Cambie su contraseña inicial antes de cambiar de función");
        if (mode === "GUARD" && !(0, firefighter_ranks_1.guardFunctionAllowed)(user.guardEligible, user.profile?.rank))
            throw new operations_schemas_1.OperationError(403, "Administración debe habilitar su función de guardia");
        const changed = await tx.authSession.updateMany({ where: { id: req.user.sessionId, userId: user.id, revokedAt: null, expiresAt: { gt: new Date() } }, data: { guardMode: mode === "GUARD" } });
        if (!changed.count)
            throw new operations_schemas_1.OperationError(401, "Sesión no disponible");
        await tx.auditLog.create({ data: { actorUserId: user.id, action: "SESSION_ACCESS_MODE_CHANGED", entityType: "AuthSession", entityId: req.user.sessionId, metadata: { mode } } });
        return (0, auth_service_1.mapSafeUser)(user, mode === "GUARD" ? "GUARD" : undefined);
    }));
});
router.get("/sessions", auth_middleware_1.authenticate, async (req, res) => {
    res.json(await (0, auth_service_1.listSessions)(req.user.userId, req.user.sessionId));
});
router.delete("/sessions", auth_middleware_1.authenticate, async (req, res) => {
    res.json(await (0, auth_service_1.revokeOtherSessions)(req.user.userId, req.user.sessionId));
});
router.delete("/sessions/:id", auth_middleware_1.authenticate, async (req, res) => {
    res.json(await (0, auth_service_1.revokeSession)(req.user.userId, String(req.params.id)));
});
router.post("/logout", auth_middleware_1.authenticate, async (req, res) => {
    res.json(await (0, auth_service_1.revokeSession)(req.user.userId, req.user.sessionId));
});
exports.default = router;
