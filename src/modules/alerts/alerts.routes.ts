import { Router } from "express";
import notices from "./notices.routes";
import {
  createAlertController,
  cancelAlertController,
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
router.use("/notices", notices);

// Todos los logueados pueden ver alertas
router.get("/", getAllAlertsController);
router.get("/:id", getAlertByIdController);
router.get("/:id/responses", getAlertResponsesController);

// Cualquier usuario autenticado puede emitir una alerta de emergencia
router.post("/", createAlertController);

// Responder alerta: cualquier usuario logueado
router.post("/:id/respond", respondToAlertController);

// Resolver alerta: ADMIN y OPERATOR
router.patch("/:id/resolve", authorize("ADMIN", "OPERATOR"), resolveAlertController);
router.patch("/:id/cancel", authorize("ADMIN", "OPERATOR", "GUARD"), cancelAlertController);

export default router;
