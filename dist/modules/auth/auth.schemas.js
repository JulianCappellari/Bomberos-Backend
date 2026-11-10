"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.changePasswordSchema = exports.refreshTokenSchema = exports.loginSchema = void 0;
const zod_1 = require("zod");
exports.loginSchema = zod_1.z.object({
    username: zod_1.z.string().trim().min(1).max(50),
    password: zod_1.z.string().min(1).max(1024),
});
exports.refreshTokenSchema = zod_1.z.object({
    refreshToken: zod_1.z.string().min(1).max(4096),
});
exports.changePasswordSchema = zod_1.z
    .object({
    currentPassword: zod_1.z.string().min(1, "Current password is required").max(1024),
    newPassword: zod_1.z.string().min(12, "Use al menos 12 caracteres").max(72).refine((value) => Buffer.byteLength(value, "utf8") <= 72, "La clave no debe superar 72 bytes"),
    confirmPassword: zod_1.z.string().min(12).max(72),
})
    .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
});
