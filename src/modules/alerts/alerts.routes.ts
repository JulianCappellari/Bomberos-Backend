import { Router } from "express";
import {
  createAlertController,
  getAlertByIdController,
  getAlertResponsesController,
  getAllAlertsController,
  resolveAlertController,
  respondToAlertController,
} from "./alerts.controller";
import { authenticate } from "../../middlewares/auth.middleware";
import { authorize } from "../../middlewares/role.middleware";

const router = Router();

router.use(authenticate);

// Todos los logueados pueden ver alertas
router.get("/", getAllAlertsController);
router.get("/:id", getAlertByIdController);
router.get("/:id/responses", getAlertResponsesController);

// Crear alerta: ADMIN y OPERATOR
router.post("/", authorize("ADMIN", "OPERATOR"), createAlertController);

// Responder alerta: cualquier usuario logueado
router.post("/:id/respond", respondToAlertController);

// Resolver alerta: ADMIN y OPERATOR
router.patch("/:id/resolve", authorize("ADMIN", "OPERATOR"), resolveAlertController);

export default router;