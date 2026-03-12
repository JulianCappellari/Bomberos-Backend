import { Request, Response } from "express";
import {
  changePasswordSchema,
  loginSchema,
  refreshTokenSchema,
} from "./auth.schemas";
import {
  changeUserPassword,
  loginUser,
  refreshUserToken,
} from "./auth.service";

export async function loginController(req: Request, res: Response) {
  try {
    const parsed = loginSchema.parse(req.body);

    const result = await loginUser(parsed.username, parsed.password);

    return res.status(200).json(result);
  } catch (error: any) {
    return res.status(401).json({
      message: error.message || "Login failed",
    });
  }
}

export async function refreshTokenController(req: Request, res: Response) {
  try {
    const parsed = refreshTokenSchema.parse(req.body);

    const result = await refreshUserToken(parsed.refreshToken);

    return res.status(200).json(result);
  } catch (error: any) {
    return res.status(401).json({
      message: error.message || "Refresh token failed",
    });
  }
}

export async function changePasswordController(req: Request, res: Response) {
  try {
    const parsed = changePasswordSchema.parse(req.body);
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const result = await changeUserPassword(
      userId,
      parsed.currentPassword,
      parsed.newPassword,
    );

    return res.status(200).json(result);
  } catch (error: any) {
    return res.status(400).json({
      message: error.message || "Change password failed",
    });
  }
}