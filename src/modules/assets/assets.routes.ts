import { Router } from "express";
import {
  createAssetController,
  createVehicleInventoryItemController,
  deleteAssetController,
  deleteVehicleInventoryItemController,
  getAllAssetsController,
  getAssetByIdController,
  updateAssetController,
  updateVehicleInventoryItemController,
  upsertVehicleDataController,
} from "./assets.controller";
import { authenticate } from "../../middlewares/auth.middleware";
import { authorize } from "../../middlewares/role.middleware";

const router = Router();

router.use(authenticate);

// Todos los logueados pueden ver assets
router.get("/", getAllAssetsController);
router.get("/:id", getAssetByIdController);

// ADMIN y OPERATOR gestionan assets
router.post("/", authorize("ADMIN", "OPERATOR"), createAssetController);
router.patch("/:id", authorize("ADMIN", "OPERATOR"), updateAssetController);
router.delete("/:id", authorize("ADMIN", "OPERATOR"), deleteAssetController);

// Datos del vehículo
router.put("/:id/vehicle", authorize("ADMIN", "OPERATOR"), upsertVehicleDataController);

// Inventario del vehículo
router.post(
  "/vehicles/:vehicleId/items",
  authorize("ADMIN", "OPERATOR"),
  createVehicleInventoryItemController,
);

router.patch(
  "/vehicles/items/:itemId",
  authorize("ADMIN", "OPERATOR"),
  updateVehicleInventoryItemController,
);

router.delete(
  "/vehicles/items/:itemId",
  authorize("ADMIN", "OPERATOR"),
  deleteVehicleInventoryItemController,
);

export default router;