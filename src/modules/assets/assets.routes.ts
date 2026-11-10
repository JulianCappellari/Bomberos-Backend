import { Router } from "express";
import { authenticate } from "../../middlewares/auth.middleware";
import { authorize } from "../../middlewares/role.middleware";
import { authorizeOrPermission } from "../../utils/special-permissions";
import {
  createAssetController,
  deleteAssetController,
  getAllAssetsController,
  getAssetByIdController,
  updateAssetController,
  upsertVehicleDataController,
} from "./assets.controller";

const router = Router();

router.post("/", authenticate, authorize("ADMIN", "OPERATOR"), createAssetController);
router.get("/", authenticate, getAllAssetsController);
router.get("/:id", authenticate, getAssetByIdController);
router.put("/:id", authenticate, authorizeOrPermission("FLEET", "ADMIN", "OPERATOR"), updateAssetController);
router.delete("/:id", authenticate, authorize("ADMIN", "OPERATOR"), deleteAssetController);
router.put("/:id/vehicle", authenticate, authorize("ADMIN", "OPERATOR"), upsertVehicleDataController);

export default router;
