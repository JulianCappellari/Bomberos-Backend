"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const shifts_controller_1 = require("./shifts.controller");
const auth_middleware_1 = require("../../middlewares/auth.middleware");
const role_middleware_1 = require("../../middlewares/role.middleware");
const zod_1 = require("zod");
const shifts_service_1 = require("./shifts.service");
const router = (0, express_1.Router)();
router.use(auth_middleware_1.authenticate);
// M02: intercambio entre bomberos con aprobacion de jefatura (bloqueado a menos de 24 h del turno).
const swapRequest = zod_1.z.object({ toUserId: zod_1.z.string().min(1).max(100), reason: zod_1.z.string().trim().min(10).max(1000) }).strict();
router.get("/swaps", async (req, res) => { res.json(await (0, shifts_service_1.listSwaps)(req.user)); });
router.post("/swaps/:id/answer", async (req, res) => { res.json(await (0, shifts_service_1.answerSwap)(String(req.params.id), zod_1.z.object({ accept: zod_1.z.boolean() }).strict().parse(req.body).accept, req.user.userId)); });
router.post("/swaps/:id/decide", (0, role_middleware_1.authorize)("ADMIN", "OPERATOR"), async (req, res) => { res.json(await (0, shifts_service_1.decideSwap)(String(req.params.id), zod_1.z.object({ approve: zod_1.z.boolean(), note: zod_1.z.string().trim().min(5).max(1000) }).strict().parse(req.body), req.user)); });
router.post("/:id/swap", async (req, res) => { res.status(201).json(await (0, shifts_service_1.requestSwap)(String(req.params.id), swapRequest.parse(req.body), req.user.userId)); });
// Todos los logueados pueden ver guardias
router.get("/", shifts_controller_1.getAllShiftsController);
router.get("/:id", shifts_controller_1.getShiftByIdController);
// Crear / asignar / borrar: ADMIN y OPERATOR
router.post("/", (0, role_middleware_1.authorize)("ADMIN", "OPERATOR"), shifts_controller_1.createShiftController);
router.put("/:id", (0, role_middleware_1.authorize)("ADMIN", "OPERATOR"), shifts_controller_1.updateShiftController);
router.post("/:id/assign-users", (0, role_middleware_1.authorize)("ADMIN", "OPERATOR"), shifts_controller_1.assignUsersToShiftController);
router.delete("/:id", (0, role_middleware_1.authorize)("ADMIN", "OPERATOR"), shifts_controller_1.deleteShiftController);
exports.default = router;
