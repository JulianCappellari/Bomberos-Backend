"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loginController = loginController;
exports.refreshTokenController = refreshTokenController;
exports.changePasswordController = changePasswordController;
const auth_schemas_1 = require("./auth.schemas");
const auth_service_1 = require("./auth.service");
async function loginController(req, res) {
    try {
        const parsed = auth_schemas_1.loginSchema.parse(req.body);
        const result = await (0, auth_service_1.loginUser)(parsed.username, parsed.password);
        return res.status(200).json(result);
    }
    catch (error) {
        return res.status(401).json({
            message: error.message || "Login failed",
        });
    }
}
async function refreshTokenController(req, res) {
    try {
        const parsed = auth_schemas_1.refreshTokenSchema.parse(req.body);
        const result = await (0, auth_service_1.refreshUserToken)(parsed.refreshToken);
        return res.status(200).json(result);
    }
    catch (error) {
        return res.status(401).json({
            message: error.message || "Refresh token failed",
        });
    }
}
async function changePasswordController(req, res) {
    try {
        const parsed = auth_schemas_1.changePasswordSchema.parse(req.body);
        const userId = req.user?.userId;
        if (!userId) {
            return res.status(401).json({ message: "Unauthorized" });
        }
        const result = await (0, auth_service_1.changeUserPassword)(userId, parsed.currentPassword, parsed.newPassword);
        return res.status(200).json(result);
    }
    catch (error) {
        return res.status(400).json({
            message: error.message || "Change password failed",
        });
    }
}
