import { Router } from "express";
import missions from "./missions.routes";
import sheet from "./incident-sheet";
import {
  assignUsersToIncidentController,
  closeIncidentController,
  createIncidentUpdateController,
  createIncidentController,
  dispatchIncidentFromAlertController,
  getAllIncidentsController,
  getIncidentByIdController,
  deleteIncidentUpdateController,
  updateIncidentController,
} from "./incidents.controller";
import { authenticate } from "../../middlewares/auth.middleware";
import { authorize } from "../../middlewares/role.middleware";
import { z } from "zod";
import { voidAndRedoIncident } from "./incident-redo.service";

const router = Router();

router.use(authenticate);
router.use("/logistics",missions);
router.use("/:id/sheet",sheet);

// Todos los logueados pueden ver incidentes
router.get("/", getAllIncidentsController);
router.get("/:id", getIncidentByIdController);
router.post("/:id/updates", createIncidentUpdateController);

// Crear / editar / cerrar / asignar: ADMIN y OPERATOR
router.post("/", authorize("ADMIN", "OPERATOR", "GUARD"), createIncidentController);
router.post(
  "/from-alert/:alertId",
  authorize("ADMIN", "OPERATOR", "GUARD"),
  dispatchIncidentFromAlertController,
);
router.patch("/:id", authorize("ADMIN", "OPERATOR", "GUARD"), updateIncidentController);
router.patch("/:id/close", closeIncidentController);
router.delete(
  "/:id/updates/:updateId",
  authorize("ADMIN", "OPERATOR", "GUARD"),
  deleteIncidentUpdateController,
);
// G15: los participantes u horarios de una intervencion cerrada se corrigen anulandola y rehaciendola.
router.post("/:id/void-and-redo", authorize("ADMIN", "OPERATOR"), async (req, res) => {
  const { reason } = z.object({ reason: z.string().trim().min(10).max(2000) }).strict().parse(req.body);
  res.status(201).json(await voidAndRedoIncident(String(req.params.id), reason, req.user!.userId));
});
router.post("/:id/assign-users", authorize("ADMIN", "OPERATOR", "GUARD"), assignUsersToIncidentController);

export default router;
