import { Router } from "express";
import {
  createInspectionController,
  getAllInspectionsController,
  getInspectionByIdController,
  getVehicleInspectionHistoryController,
} from "./inspections.controller";
import { authenticate } from "../../middlewares/auth.middleware";
import { authorize } from "../../middlewares/role.middleware";

const router = Router();

router.use(authenticate);

router.get("/", getAllInspectionsController);
router.get("/vehicle/:vehicleId/history", getVehicleInspectionHistoryController);
router.get("/:id", getInspectionByIdController);

router.post("/", authorize("ADMIN", "OPERATOR"), createInspectionController);

export default router;