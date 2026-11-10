import { Router } from "express";
import { authenticate } from "../../middlewares/auth.middleware";
import { authorize } from "../../middlewares/role.middleware";
import {
  createComplianceRecordController,
  deleteComplianceRecordController,
  getComplianceSummaryController,
  listComplianceRecordsController,
  updateComplianceRecordController,
} from "./compliance.controller";

const router = Router();
router.use(authenticate);
router.use(authorize("ADMIN", "OPERATOR", "GUARD"));
router.get("/", listComplianceRecordsController);
router.get("/summary", getComplianceSummaryController);
router.post("/", authorize("ADMIN", "OPERATOR", "GUARD"), createComplianceRecordController);
router.put("/:id", authorize("ADMIN", "OPERATOR", "GUARD"), updateComplianceRecordController);
router.delete("/:id", authorize("ADMIN", "OPERATOR", "GUARD"), deleteComplianceRecordController);

export default router;
