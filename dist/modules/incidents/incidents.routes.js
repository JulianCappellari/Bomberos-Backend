"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const missions_routes_1 = __importDefault(require("./missions.routes"));
const incident_sheet_1 = __importDefault(require("./incident-sheet"));
const incidents_controller_1 = require("./incidents.controller");
const auth_middleware_1 = require("../../middlewares/auth.middleware");
const role_middleware_1 = require("../../middlewares/role.middleware");
const zod_1 = require("zod");
const incident_redo_service_1 = require("./incident-redo.service");
const router = (0, express_1.Router)();
router.use(auth_middleware_1.authenticate);
router.use("/logistics", missions_routes_1.default);
router.use("/:id/sheet", incident_sheet_1.default);
// Todos los logueados pueden ver incidentes
router.get("/", incidents_controller_1.getAllIncidentsController);
router.get("/:id", incidents_controller_1.getIncidentByIdController);
router.post("/:id/updates", incidents_controller_1.createIncidentUpdateController);
// Crear / editar / cerrar / asignar: ADMIN y OPERATOR
router.post("/", (0, role_middleware_1.authorize)("ADMIN", "OPERATOR", "GUARD"), incidents_controller_1.createIncidentController);
router.post("/from-alert/:alertId", (0, role_middleware_1.authorize)("ADMIN", "OPERATOR", "GUARD"), incidents_controller_1.dispatchIncidentFromAlertController);
router.patch("/:id", (0, role_middleware_1.authorize)("ADMIN", "OPERATOR", "GUARD"), incidents_controller_1.updateIncidentController);
router.patch("/:id/close", incidents_controller_1.closeIncidentController);
router.delete("/:id/updates/:updateId", (0, role_middleware_1.authorize)("ADMIN", "OPERATOR", "GUARD"), incidents_controller_1.deleteIncidentUpdateController);
// G15: los participantes u horarios de una intervencion cerrada se corrigen anulandola y rehaciendola.
router.post("/:id/void-and-redo", (0, role_middleware_1.authorize)("ADMIN", "OPERATOR"), async (req, res) => {
    const { reason } = zod_1.z.object({ reason: zod_1.z.string().trim().min(10).max(2000) }).strict().parse(req.body);
    res.status(201).json(await (0, incident_redo_service_1.voidAndRedoIncident)(String(req.params.id), reason, req.user.userId));
});
router.post("/:id/assign-users", (0, role_middleware_1.authorize)("ADMIN", "OPERATOR", "GUARD"), incidents_controller_1.assignUsersToIncidentController);
exports.default = router;
