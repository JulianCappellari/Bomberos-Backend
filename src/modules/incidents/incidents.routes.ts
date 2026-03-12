import { Router } from "express";
import {
  assignUsersToIncidentController,
  closeIncidentController,
  createIncidentController,
  getAllIncidentsController,
  getIncidentByIdController,
  updateIncidentController,
} from "./incidents.controller";
import { authenticate } from "../../middlewares/auth.middleware";
import { authorize } from "../../middlewares/role.middleware";

const router = Router();

router.use(authenticate);

// Todos los logueados pueden ver incidentes
router.get("/", getAllIncidentsController);
router.get("/:id", getIncidentByIdController);

// Crear / editar / cerrar / asignar: ADMIN y OPERATOR
router.post("/", authorize("ADMIN", "OPERATOR"), createIncidentController);
router.patch("/:id", authorize("ADMIN", "OPERATOR"), updateIncidentController);
router.patch("/:id/close", authorize("ADMIN", "OPERATOR"), closeIncidentController);
router.post("/:id/assign-users", authorize("ADMIN", "OPERATOR"), assignUsersToIncidentController);

export default router;