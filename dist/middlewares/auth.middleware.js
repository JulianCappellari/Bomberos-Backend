"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.authenticate = authenticate;
const jwt_1 = require("../utils/jwt");
const prisma_1 = require("../config/prisma");
async function authenticate(req, res, next) {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return res.status(401).json({ message: "Unauthorized" });
        }
        const token = authHeader.split(" ")[1];
        const payload = (0, jwt_1.verifyAccessToken)(token);
        const user = await prisma_1.prisma.user.findFirst({
            where: {
                id: payload.userId,
                isActive: true,
                isPendingApproval: false,
                deletedAt: null,
            },
            select: {
                id: true,
                role: true,
            },
        });
        if (!user) {
            return res.status(401).json({ message: "User is not allowed to access" });
        }
        req.user = {
            userId: user.id,
            role: user.role,
        };
        next();
    }
    catch {
        return res.status(401).json({ message: "Invalid or expired token" });
    }
}
