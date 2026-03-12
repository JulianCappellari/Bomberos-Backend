import { Router } from "express";
import {
  changePasswordController,
  loginController,
  refreshTokenController,
} from "./auth.controller";
import { authenticate } from "../../middlewares/auth.middleware";

const router = Router();

router.post("/login", loginController);
router.post("/refresh", refreshTokenController);
router.patch("/change-password", authenticate, changePasswordController);

export default router;