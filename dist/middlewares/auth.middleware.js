"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.authenticate = authenticate;
const auth_session_1 = require("../utils/auth-session");
async function authenticate(req, res, next) {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return res.status(401).json({ message: "Unauthorized" });
        }
        const token = authHeader.split(" ")[1];
        const user = await (0, auth_session_1.authenticateAccessToken)(token);
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
    }
    catch {
        return res.status(401).json({ message: "Invalid or expired token" });
    }
}
