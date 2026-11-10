import { Server as HttpServer } from "http";
import { Server } from "socket.io";
import { env } from "./env";
import { authenticateAccessToken } from "../utils/auth-session";
let io: Server | null = null;

export function initSocket(server: HttpServer) {
  io = new Server(server, {
    cors: { origin: env.corsOrigins, credentials: true },
    allowRequest(req, callback) {
      const origin = req.headers.origin;
      callback(null, !origin || env.corsOrigins.includes(origin));
    },
  });
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (typeof token !== "string" || token.length > 4096) return next(new Error("Unauthorized"));
      const identity = await authenticateAccessToken(token);
      if (identity.mustChangePassword) return next(new Error("Password change required"));
      socket.data.identity = identity;
      next();
    } catch { next(new Error("Unauthorized")); }
  });
  io.on("connection", (socket) => {
    const identity = socket.data.identity as Awaited<ReturnType<typeof authenticateAccessToken>>;
    socket.join(["alerts", `session:${identity.sessionId}`, `user:${identity.userId}`]);
    const expiry = setTimeout(() => socket.disconnect(true), Math.max(0, identity.tokenExpiresAt - Date.now()));
    expiry.unref();
    socket.on("join_alerts", () => socket.join("alerts"));
    socket.on("disconnect", () => clearTimeout(expiry));
  });
  return io;
}
export function disconnectSession(id: string) { io?.in(`session:${id}`).disconnectSockets(true); }
export function disconnectUser(id: string) { io?.in(`user:${id}`).disconnectSockets(true); }
export function emitAlertEvent(event: string, payload: unknown) {
  if (!io) { console.warn("Alert persisted; realtime relay unavailable"); return; }
  io.to("alerts").emit(event, payload);
}
export function getSocketIO(): Server {
  if (!io) throw new Error("Socket.io not initialized!");
  return io;
}
