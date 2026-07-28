"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const incidents_controller_1 = require("./incidents.controller");
const auth_middleware_1 = require("../../middlewares/auth.middleware");
const role_middleware_1 = require("../../middlewares/role.middleware");
const router = (0, express_1.Router)();
router.use(auth_middleware_1.authenticate);
// Todos los logueados pueden ver incidentes
router.get("/", incidents_controller_1.getAllIncidentsController);
router.get("/:id", incidents_controller_1.getIncidentByIdController);
// Crear / editar / cerrar / asignar: ADMIN y OPERATOR
router.post("/", (0, role_middleware_1.authorize)("ADMIN", "OPERATOR"), incidents_controller_1.createIncidentController);
router.patch("/:id", (0, role_middleware_1.authorize)("ADMIN", "OPERATOR"), incidents_controller_1.updateIncidentController);
router.patch("/:id/close", (0, role_middleware_1.authorize)("ADMIN", "OPERATOR"), incidents_controller_1.closeIncidentController);
router.post("/:id/assign-users", (0, role_middleware_1.authorize)("ADMIN", "OPERATOR"), incidents_controller_1.assignUsersToIncidentController);
exports.default = router;
