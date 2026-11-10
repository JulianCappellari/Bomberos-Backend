import { NextFunction, Request, Response } from "express";
import { authenticateAccessToken } from "../utils/auth-session";

declare global {
  namespace Express {
    interface Request {
      user?: {
        userId: string;
        role: string;
        rank?: string | null;
        sessionId?: string;
        permissions?: string[];
      };
    }
  }
}

export async function authenticate(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const token = authHeader.split(" ")[1];
    const user = await authenticateAccessToken(token);
    if (user.mustChangePassword && !req.originalUrl.startsWith("/api/auth/")) {
      return res.status(403).json({ code: "PASSWORD_CHANGE_REQUIRED", message: "Debe cambiar su contrasena inicial" });
    }

    req.user = {
      userId: user.userId,
      role: user.role,
      rank: user.rank,
      sessionId: user.sessionId,
      permissions: user.permissions,
    };

    next();
  } catch {
    return res.status(401).json({ message: "Invalid or expired token" });
  }
}
