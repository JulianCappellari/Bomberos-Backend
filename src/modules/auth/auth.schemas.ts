import { z } from "zod";

export const loginSchema = z.object({
  username: z.string().trim().min(1).max(50),
  password: z.string().min(1).max(1024),
});

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1).max(4096),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Current password is required").max(1024),
    newPassword: z.string().min(12, "Use al menos 12 caracteres").max(72).refine((value) => Buffer.byteLength(value, "utf8") <= 72, "La clave no debe superar 72 bytes"),
    confirmPassword: z.string().min(12).max(72),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });
