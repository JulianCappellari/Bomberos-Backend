// Carga explicita de .env: no depender de que otro modulo (Prisma) lo haga antes por casualidad.
import "dotenv/config";
export const env = {
  port: Number(process.env.PORT || 4000),
  corsOrigins: (process.env.CORS_ORIGINS || "http://localhost:3000")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
  jwtAccessSecret: process.env.JWT_ACCESS_SECRET || "",
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET || "",
  jwtAccessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || "15m",
  jwtRefreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || "7d",
};

if (!env.jwtAccessSecret || !env.jwtRefreshSecret) {
  throw new Error("Missing JWT environment variables");
}
if (process.env.NODE_ENV === "production" && (env.jwtAccessSecret.length < 32 || env.jwtRefreshSecret.length < 32 || env.jwtAccessSecret === env.jwtRefreshSecret)) {
  throw new Error("Production requires distinct JWT secrets of at least 32 characters");
}
