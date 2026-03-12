import { Router } from "express";
import {
  approveApplicationController,
  createApplicationController,
  getAllApplicationsController,
  getApplicationByIdController,
  rejectApplicationController,
} from "./applications.controller";
import { authenticate } from "../../middlewares/auth.middleware";
import { authorize } from "../../middlewares/role.middleware";

const router = Router();

router.post("/", createApplicationController);

router.get("/", authenticate, authorize("ADMIN"), getAllApplicationsController);
router.get("/:id", authenticate, authorize("ADMIN"), getApplicationByIdController);
router.patch("/:id/approve", authenticate, authorize("ADMIN"), approveApplicationController);
router.patch("/:id/reject", authenticate, authorize("ADMIN"), rejectApplicationController);

export default router;