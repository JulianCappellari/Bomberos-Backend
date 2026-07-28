"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.loginUser = loginUser;
exports.refreshUserToken = refreshUserToken;
exports.changeUserPassword = changeUserPassword;
const bcrypt_1 = __importDefault(require("bcrypt"));
const prisma_1 = require("../../config/prisma");
const jwt_1 = require("../../utils/jwt");
function mapSafeUser(user) {
    return {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        isActive: user.isActive,
        isPendingApproval: user.isPendingApproval,
        profile: user.profile
            ? {
                fullName: user.profile.fullName,
                rank: user.profile.rank,
                badge: user.profile.badge,
            }
            : null,
    };
}
async function loginUser(username, password) {
    const user = await prisma_1.prisma.user.findUnique({
        where: { username },
        include: { profile: true },
    });
    if (!user) {
        throw new Error("Invalid credentials");
    }
    if (!user.isActive) {
        throw new Error("Account is inactive");
    }
    if (user.isPendingApproval) {
        throw new Error("Account pending approval");
    }
    const passwordMatches = await bcrypt_1.default.compare(password, user.passwordHash);
    if (!passwordMatches) {
        throw new Error("Invalid credentials");
    }
    const payload = {
        userId: user.id,
        role: user.role,
    };
    const accessToken = (0, jwt_1.signAccessToken)(payload);
    const refreshToken = (0, jwt_1.signRefreshToken)(payload);
    return {
        user: mapSafeUser(user),
        tokens: {
            accessToken,
            refreshToken,
        },
    };
}
async function refreshUserToken(refreshToken) {
    const payload = (0, jwt_1.verifyRefreshToken)(refreshToken);
    const user = await prisma_1.prisma.user.findUnique({
        where: { id: payload.userId },
        include: { profile: true },
    });
    if (!user) {
        throw new Error("User not found");
    }
    if (!user.isActive || user.isPendingApproval) {
        throw new Error("User is not allowed to access");
    }
    const newAccessToken = (0, jwt_1.signAccessToken)({
        userId: user.id,
        role: user.role,
    });
    return {
        accessToken: newAccessToken,
    };
}
async function changeUserPassword(userId, currentPassword, newPassword) {
    const user = await prisma_1.prisma.user.findUnique({
        where: { id: userId },
    });
    if (!user) {
        throw new Error("User not found");
    }
    const passwordMatches = await bcrypt_1.default.compare(currentPassword, user.passwordHash);
    if (!passwordMatches) {
        throw new Error("Current password is incorrect");
    }
    const newPasswordHash = await bcrypt_1.default.hash(newPassword, 10);
    await prisma_1.prisma.user.update({
        where: { id: userId },
        data: {
            passwordHash: newPasswordHash,
        },
    });
    return {
        message: "Password updated successfully",
    };
}
