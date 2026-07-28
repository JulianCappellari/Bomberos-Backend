"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const shifts_controller_1 = require("./shifts.controller");
const auth_middleware_1 = require("../../middlewares/auth.middleware");
const role_middleware_1 = require("../../middlewares/role.middleware");
const router = (0, express_1.Router)();
router.use(auth_middleware_1.authenticate);
// Todos los logueados pueden ver guardias
router.get("/", shifts_controller_1.getAllShiftsController);
router.get("/:id", shifts_controller_1.getShiftByIdController);
// Crear / asignar / borrar: ADMIN y OPERATOR
router.post("/", (0, role_middleware_1.authorize)("ADMIN", "OPERATOR"), shifts_controller_1.createShiftController);
router.post("/:id/assign-users", (0, role_middleware_1.authorize)("ADMIN", "OPERATOR"), shifts_controller_1.assignUsersToShiftController);
router.delete("/:id", (0, role_middleware_1.authorize)("ADMIN", "OPERATOR"), shifts_controller_1.deleteShiftController);
exports.default = router;
