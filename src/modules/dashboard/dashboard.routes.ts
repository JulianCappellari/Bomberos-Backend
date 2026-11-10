import { Router } from "express";
import { authenticate } from "../../middlewares/auth.middleware";
import {
  getDashboardSummaryController,
  getOperationalReadinessController,
} from "./dashboard.controller";

const router = Router();

router.get("/summary", authenticate, getDashboardSummaryController);
router.get("/readiness", authenticate, getOperationalReadinessController);

export default router;
