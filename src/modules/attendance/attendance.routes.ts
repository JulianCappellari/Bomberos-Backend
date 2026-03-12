import { Router } from "express";
import {
  createAttendanceQrChallengeController,
  getMyAttendancesController,
  getMyAttendanceSummaryController,
  getMyOpenAttendanceController,
  scanAttendanceQrController,
} from "./attendance.controller";
import { authenticate } from "../../middlewares/auth.middleware";


const router = Router();

router.post("/qr-challenges", authenticate, createAttendanceQrChallengeController);
router.post("/scan", authenticate, scanAttendanceQrController);
router.get("/me/open", authenticate, getMyOpenAttendanceController);
router.get("/me", authenticate, getMyAttendancesController);
router.get("/me/summary", authenticate, getMyAttendanceSummaryController);

export default router;