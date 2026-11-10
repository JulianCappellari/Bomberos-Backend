import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { randomUUID } from "node:crypto";

type JwtPayload = {
  userId: string;
  role: string;
  sessionId: string;
};

type VerifiedPayload = JwtPayload & { exp: number; tokenUse: "access" | "refresh" };
const issuer = "bomberos-api";
const audience = "bomberos-app";

export function signAccessToken(payload: JwtPayload) {
  return jwt.sign({ ...payload, tokenUse: "access" }, env.jwtAccessSecret, {
    algorithm: "HS256", issuer, audience, jwtid: randomUUID(),
    expiresIn: env.jwtAccessExpiresIn as jwt.SignOptions["expiresIn"],
  });
}

export function signRefreshToken(payload: JwtPayload) {
  return jwt.sign({ ...payload, tokenUse: "refresh" }, env.jwtRefreshSecret, {
    algorithm: "HS256", issuer, audience, jwtid: randomUUID(),
    expiresIn: env.jwtRefreshExpiresIn as jwt.SignOptions["expiresIn"],
  });
}

export function verifyAccessToken(token: string) {
  return verify(token, env.jwtAccessSecret, "access");
}

export function verifyRefreshToken(token: string) {
  return verify(token, env.jwtRefreshSecret, "refresh");
}

function verify(token: string, secret: string, tokenUse: "access" | "refresh"): VerifiedPayload {
  const payload = jwt.verify(token, secret, { algorithms: ["HS256"], issuer, audience });
  if (typeof payload === "string" || typeof payload.userId !== "string" || typeof payload.sessionId !== "string" ||
      typeof payload.role !== "string" || typeof payload.exp !== "number" || payload.tokenUse !== tokenUse) {
    throw new Error("Invalid session token");
  }
  return payload as VerifiedPayload;
}
