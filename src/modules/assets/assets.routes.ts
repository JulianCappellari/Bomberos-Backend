import { Router } from "express";
import { authenticate } from "../../middlewares/auth.middleware";
import {
  createAssetController,
  deleteAssetController,
  getAllAssetsController,
  getAssetByIdController,
  updateAssetController,
  upsertVehicleDataController,
} from "./assets.controller";

const router = Router();

router.post("/", authenticate, createAssetController);
router.get("/", authenticate, getAllAssetsController);
router.get("/:id", authenticate, getAssetByIdController);
router.put("/:id", authenticate, updateAssetController);
router.delete("/:id", authenticate, deleteAssetController);
router.put("/:id/vehicle", authenticate, upsertVehicleDataController);

export default router;