"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_controller_1 = require("./auth.controller");
const auth_middleware_1 = require("../../middlewares/auth.middleware");
const rate_limit_middleware_1 = require("../../middlewares/rate-limit.middleware");
const router = (0, express_1.Router)();
const authRateLimit = (0, rate_limit_middleware_1.rateLimit)({
    windowMs: 60000,
    maxRequests: 10,
    message: "Demasiados intentos. Probá nuevamente en un minuto.",
});
router.post("/login", authRateLimit, auth_controller_1.loginController);
router.post("/refresh", authRateLimit, auth_controller_1.refreshTokenController);
router.patch("/change-password", auth_middleware_1.authenticate, auth_controller_1.changePasswordController);
exports.default = router;
