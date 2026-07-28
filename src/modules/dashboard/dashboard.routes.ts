import { Router } from "express";
import { authenticate } from "../../middlewares/auth.middleware";
import { getDashboardSummaryController } from "./dashboard.controller";

const router = Router();

router.get("/summary", authenticate, getDashboardSummaryController);

export default router;
