import { Router } from "express";
import { authenticate } from "../../middlewares/auth.middleware";
import { authorize } from "../../middlewares/role.middleware";
import { listAuditLogsController } from "./audit.controller";

const router = Router();

router.use(authenticate);
router.use(authorize("ADMIN", "OPERATOR"));

router.get("/", listAuditLogsController);

export default router;
