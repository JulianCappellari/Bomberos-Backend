"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const alerts_controller_1 = require("./alerts.controller");
const auth_middleware_1 = require("../../middlewares/auth.middleware");
const role_middleware_1 = require("../../middlewares/role.middleware");
const router = (0, express_1.Router)();
router.use(auth_middleware_1.authenticate);
// Todos los logueados pueden ver alertas
router.get("/", alerts_controller_1.getAllAlertsController);
router.get("/:id", alerts_controller_1.getAlertByIdController);
router.get("/:id/responses", alerts_controller_1.getAlertResponsesController);
// Crear alerta: ADMIN y OPERATOR
router.post("/", (0, role_middleware_1.authorize)("ADMIN", "OPERATOR"), alerts_controller_1.createAlertController);
// Responder alerta: cualquier usuario logueado
router.post("/:id/respond", alerts_controller_1.respondToAlertController);
// Resolver alerta: ADMIN y OPERATOR
router.patch("/:id/resolve", (0, role_middleware_1.authorize)("ADMIN", "OPERATOR"), alerts_controller_1.resolveAlertController);
exports.default = router;
