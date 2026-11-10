"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const control_drafts_1 = __importDefault(require("./control-drafts"));
const inspection_confirmation_service_1 = require("./inspection-confirmation.service");
const inspections_controller_1 = require("./inspections.controller");
const auth_middleware_1 = require("../../middlewares/auth.middleware");
const zod_1 = require("zod");
const role_middleware_1 = require("../../middlewares/role.middleware");
const inspection_administration_service_1 = require("./inspection-administration.service");
const router = (0, express_1.Router)();
router.use(auth_middleware_1.authenticate);
router.use("/drafts", control_drafts_1.default);
router.post("/:id/confirm", async (req, res) => { res.json(await (0, inspection_confirmation_service_1.confirmInspection)(String(req.params.id), req.user.userId)); });
const amendment = zod_1.z.object({ revision: zod_1.z.number().int().positive(), reason: zod_1.z.string().trim().min(10).max(2000), amendment: zod_1.z.string().trim().min(10).max(4000) }).strict();
router.post("/:id/participants/:userId/remove", (0, role_middleware_1.authorize)("ADMIN", "OPERATOR"), async (req, res) => { res.json(await (0, inspection_confirmation_service_1.removeInspectionParticipant)(String(req.params.id), String(req.params.userId), amendment.omit({ amendment: true }).parse(req.body), req.user)); });
// H12: rectifican o anulan un control finalizado Administrador, Oficial y Suboficial.
router.patch("/:id", (0, role_middleware_1.authorize)("ADMIN", "OPERATOR"), async (req, res) => { res.json(await (0, inspection_administration_service_1.amendInspection)(String(req.params.id), req.user, amendment.parse(req.body), false)); });
router.delete("/:id", (0, role_middleware_1.authorize)("ADMIN", "OPERATOR"), async (req, res) => { res.json(await (0, inspection_administration_service_1.amendInspection)(String(req.params.id), req.user, amendment.omit({ amendment: true }).parse(req.body), true)); });
router.get("/", inspections_controller_1.getAllInspectionsController);
router.get("/vehicle/:vehicleId/history", inspections_controller_1.getVehicleInspectionHistoryController);
router.get("/:id", inspections_controller_1.getInspectionByIdController);
router.post("/", auth_middleware_1.authenticate, inspections_controller_1.createInspectionController);
exports.default = router;
