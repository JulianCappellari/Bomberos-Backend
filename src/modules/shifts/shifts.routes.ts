import { Router } from "express";
import {
  assignUsersToShiftController,
  createShiftController,
  deleteShiftController,
  getAllShiftsController,
  getShiftByIdController,
} from "./shifts.controller";
import { authenticate } from "../../middlewares/auth.middleware";
import { authorize } from "../../middlewares/role.middleware";

const router = Router();

router.use(authenticate);

// Todos los logueados pueden ver guardias
router.get("/", getAllShiftsController);
router.get("/:id", getShiftByIdController);

// Crear / asignar / borrar: ADMIN y OPERATOR
router.post("/", authorize("ADMIN", "OPERATOR"), createShiftController);
router.post("/:id/assign-users", authorize("ADMIN", "OPERATOR"), assignUsersToShiftController);
router.delete("/:id", authorize("ADMIN", "OPERATOR"), deleteShiftController);

export default router;