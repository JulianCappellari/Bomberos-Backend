import { Router } from "express";
import { authenticate } from "../../middlewares/auth.middleware";
import { authorize } from "../../middlewares/role.middleware";
import {
  createCompartmentController,
  createInspectionController,
  createInventoryItemController,
  deleteInventoryItemController,
  getInspectionByIdController,
  getVehicleInspectionsController,
  getVehicleInventoryController,
  updateInventoryItemController,
} from "./equipment.controller";

const router = Router();

router.post(
  "/vehicles/:vehicleId/compartments",
  authenticate,
  authorize("ADMIN", "OPERATOR"),
  createCompartmentController,
);
router.post(
  "/compartments/:compartmentId/items",
  authenticate,
  authorize("ADMIN", "OPERATOR"),
  createInventoryItemController,
);
router.patch(
  "/items/:itemId",
  authenticate,
  authorize("ADMIN", "OPERATOR"),
  updateInventoryItemController,
);
router.delete(
  "/items/:itemId",
  authenticate,
  authorize("ADMIN", "OPERATOR"),
  deleteInventoryItemController,
);
router.get("/vehicles/:vehicleId/inventory", authenticate, getVehicleInventoryController);

router.post(
  "/inspections",
  authenticate,
  authorize("ADMIN", "OPERATOR"),
  createInspectionController,
);
router.get("/inspections/:id", authenticate, getInspectionByIdController);
router.get("/vehicles/:vehicleId/inspections", authenticate, getVehicleInspectionsController);

export default router;
