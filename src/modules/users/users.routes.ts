import { requireStepUp } from "../../middlewares/step-up.middleware";
import { Router } from "express";
import {setGuardEligibility} from "./guard-eligibility.service";
import {
  createUserController,
  getActiveUserRosterController,
  getAllUsersController,
  getUserByIdController,
  toggleUserActiveController,
  updateUserController,
} from "./users.controller";
import { authenticate } from "../../middlewares/auth.middleware";
import { authorize } from "../../middlewares/role.middleware";
import { z } from "zod";
import { SPECIAL_PERMISSIONS } from "../../utils/special-permissions";
import { setSpecialPermission } from "./special-permissions.service";
import { administerAccount } from "./account-administration.service";
import { rateLimit } from "../../middlewares/rate-limit.middleware";

const router = Router();

router.use(authenticate);
router.put("/:id/guard-eligibility",authorize("ADMIN"),requireStepUp,async(req,res)=>{
  const {enabled,revision,reason}=z.object({enabled:z.boolean(),revision:z.string().datetime(),reason:z.string().trim().min(10).max(1000)}).strict().parse(req.body);
  res.json(await setGuardEligibility(String(req.params.id),enabled,revision,reason,req.user!.userId));
});
router.put("/:id/permissions",authorize("ADMIN"),requireStepUp,async(req,res)=>{
  const {permission,enabled,revision,reason}=z.object({permission:z.enum(SPECIAL_PERMISSIONS),enabled:z.boolean(),revision:z.string().datetime(),reason:z.string().trim().min(10).max(1000)}).strict().parse(req.body);
  res.json(await setSpecialPermission(String(req.params.id),permission,enabled,revision,reason,req.user!.userId));
});
const accountAction = z.object({ reason: z.string().trim().min(10).max(2000), revision: z.string().datetime() }).strict();
router.delete("/:id", authorize("ADMIN"), requireStepUp, async (req, res) => { res.json(await administerAccount(String(req.params.id), req.user!, accountAction.parse(req.body), true)); });
router.post("/:id/reset-password", authorize("ADMIN"), requireStepUp, rateLimit({ windowMs: 60000, maxRequests: 5 }), async (req, res) => { res.json(await administerAccount(String(req.params.id), req.user!, accountAction.parse(req.body), false)); });

router.get("/roster", getActiveUserRosterController);
router.get("/", authorize("ADMIN"), getAllUsersController);
router.get("/:id", authorize("ADMIN"), getUserByIdController);
router.post("/", authorize("ADMIN"), createUserController);
router.patch("/:id", authorize("ADMIN"), requireStepUp, updateUserController);
router.patch("/:id/toggle-active", authorize("ADMIN"), requireStepUp, toggleUserActiveController);

export default router;
