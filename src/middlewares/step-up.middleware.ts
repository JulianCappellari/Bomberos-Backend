import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import { env } from "../config/env";

// Confirmacion de contrasena para acciones criticas ("step-up"). Aunque alguien tome un celular con la
// sesion abierta de un oficial, no puede dar de baja personas, cambiar permisos, registrar pagos ni anular
// intervenciones sin volver a escribir la contrasena. La confirmacion vale 5 minutos, solo para esa sesion.
const ISSUER = "bomberos-api", AUDIENCE = "bomberos-step-up";
export const STEP_UP_MINUTES = 5;
export const STEP_UP_HEADER = "x-step-up";

export function issueStepUpToken(userId: string, sessionId: string) {
  return jwt.sign({ userId, sessionId, tokenUse: "step_up" }, env.jwtAccessSecret, { algorithm: "HS256", issuer: ISSUER, audience: AUDIENCE, jwtid: randomUUID(), expiresIn: `${STEP_UP_MINUTES}m` });
}

export function hasValidStepUp(req: Request) {
  const token = req.get(STEP_UP_HEADER);
  if (!token || token.length > 2048 || !req.user?.sessionId) return false;
  try {
    const payload = jwt.verify(token, env.jwtAccessSecret, { algorithms: ["HS256"], issuer: ISSUER, audience: AUDIENCE });
    return typeof payload !== "string" && payload.tokenUse === "step_up" && payload.userId === req.user.userId && payload.sessionId === req.user.sessionId;
  } catch { return false; }
}

/** Exige confirmacion reciente de contrasena. Responde 428 para que la app la pida y reintente. */
export function requireStepUp(req: Request, res: Response, next: NextFunction) {
  if (hasValidStepUp(req)) return next();
  return res.status(428).json({ code: "STEP_UP_REQUIRED", message: "Por seguridad, confirmá tu contraseña para continuar." });
}
