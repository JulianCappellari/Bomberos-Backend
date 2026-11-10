import { z } from "zod";
import { FIREFIGHTER_RANKS } from "../../utils/firefighter-ranks";

export const createUserSchema = z.object({
  username: z.string().min(3).max(50),
  email: z.string().email().optional().or(z.literal("")),
  password: z.string().min(12).max(72).refine((value) => Buffer.byteLength(value, "utf8") <= 72, "La clave no debe superar 72 bytes"),
  role: z.enum(["ADMIN", "FIREFIGHTER", "OPERATOR", "GUARD"]),
  fullName: z.string().min(3).max(120),
  dni: z.string().min(6).max(20),
  rank: z.enum(FIREFIGHTER_RANKS),
  badge: z.string().min(1).max(30),
  birthDate: z.string().optional().or(z.literal("")),
  phone: z.string().optional().or(z.literal("")),
  altPhone: z.string().optional().or(z.literal("")),
  address: z.string().optional().or(z.literal("")),
  bloodType: z.string().optional().or(z.literal("")),
  joinDate: z.string().optional().or(z.literal("")),
  emergencyContact: z
    .object({
      fullName: z.string().min(2).max(120),
      phone: z.string().min(3).max(40),
      relationship: z.string().optional().or(z.literal("")),
    })
    .optional(),
});

export const updateUserSchema = z.object({
  revision: z.string().datetime().optional(),
  email: z.string().email().optional().or(z.literal("")),
  role: z.enum(["ADMIN", "FIREFIGHTER", "OPERATOR", "GUARD"]).optional(),
  isActive: z.boolean().optional(),
  fullName: z.string().min(3).max(120).optional(),
  dni: z.string().min(6).max(20).optional(),
  rank: z.enum(FIREFIGHTER_RANKS).optional(),
  badge: z.string().min(1).max(30).optional(),
  birthDate: z.string().optional().or(z.literal("")),
  phone: z.string().optional().or(z.literal("")),
  altPhone: z.string().optional().or(z.literal("")),
  address: z.string().optional().or(z.literal("")),
  bloodType: z.string().optional().or(z.literal("")),
  joinDate: z.string().optional().or(z.literal("")),
  emergencyContact: z
    .object({
      fullName: z.string().min(2).max(120),
      phone: z.string().min(3).max(40),
      relationship: z.string().optional().or(z.literal("")),
    })
    .optional(),
});
