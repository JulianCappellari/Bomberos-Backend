"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.initSocket = initSocket;
exports.disconnectSession = disconnectSession;
exports.disconnectUser = disconnectUser;
exports.emitAlertEvent = emitAlertEvent;
exports.getSocketIO = getSocketIO;
const socket_io_1 = require("socket.io");
const env_1 = require("./env");
const auth_session_1 = require("../utils/auth-session");
let io = null;
function initSocket(server) {
    io = new socket_io_1.Server(server, {
        cors: { origin: env_1.env.corsOrigins, credentials: true },
        allowRequest(req, callback) {
            const origin = req.headers.origin;
            callback(null, !origin || env_1.env.corsOrigins.includes(origin));
        },
    });
    io.use(async (socket, next) => {
        try {
            const token = socket.handshake.auth?.token;
            if (typeof token !== "string" || token.length > 4096)
                return next(new Error("Unauthorized"));
            const identity = await (0, auth_session_1.authenticateAccessToken)(token);
            if (identity.mustChangePassword)
                return next(new Error("Password change required"));
            socket.data.identity = identity;
            next();
        }
        catch {
            next(new Error("Unauthorized"));
        }
    });
    io.on("connection", (socket) => {
        const identity = socket.data.identity;
        socket.join(["alerts", `session:${identity.sessionId}`, `user:${identity.userId}`]);
        const expiry = setTimeout(() => socket.disconnect(true), Math.max(0, identity.tokenExpiresAt - Date.now()));
        expiry.unref();
        socket.on("join_alerts", () => socket.join("alerts"));
        socket.on("disconnect", () => clearTimeout(expiry));
    });
    return io;
}
function disconnectSession(id) { io?.in(`session:${id}`).disconnectSockets(true); }
function disconnectUser(id) { io?.in(`user:${id}`).disconnectSockets(true); }
function emitAlertEvent(event, payload) {
    if (!io) {
        console.warn("Alert persisted; realtime relay unavailable");
        return;
    }
    io.to("alerts").emit(event, payload);
}
function getSocketIO() {
    if (!io)
        throw new Error("Socket.io not initialized!");
    return io;
}
