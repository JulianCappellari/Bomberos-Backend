import { Router } from "express";
import {
  changePasswordController,
  loginController,
  refreshTokenController,
} from "./auth.controller";
import { authenticate } from "../../middlewares/auth.middleware";
import { rateLimit } from "../../middlewares/rate-limit.middleware";

const router = Router();

const authRateLimit = rateLimit({
  windowMs: 60_000,
  maxRequests: 10,
  message: "Demasiados intentos. Probá nuevamente en un minuto.",
});

router.post("/login", authRateLimit, loginController);
router.post("/refresh", authRateLimit, refreshTokenController);
router.patch("/change-password", authenticate, changePasswordController);

export default router;
