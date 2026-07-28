import { Router } from "express";
import {
  createAttendanceQrChallengeController,
  getMyAttendancesController,
  getMyAttendanceSummaryController,
  getMyOpenAttendanceController,
  getPresentPersonnelController,
  scanAttendanceQrController,
} from "./attendance.controller";
import { authenticate } from "../../middlewares/auth.middleware";
import { authorize } from "../../middlewares/role.middleware";


const router = Router();

router.post(
  "/qr-challenges",
  authenticate,
  authorize("ADMIN", "OPERATOR"),
  createAttendanceQrChallengeController,
);
router.post("/scan", authenticate, scanAttendanceQrController);
router.get("/present", authenticate, getPresentPersonnelController);
router.get("/me/open", authenticate, getMyOpenAttendanceController);
router.get("/me", authenticate, getMyAttendancesController);
router.get("/me/summary", authenticate, getMyAttendanceSummaryController);

export default router;
