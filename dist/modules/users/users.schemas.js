"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateUserSchema = exports.createUserSchema = void 0;
const zod_1 = require("zod");
const firefighter_ranks_1 = require("../../utils/firefighter-ranks");
exports.createUserSchema = zod_1.z.object({
    username: zod_1.z.string().min(3).max(50),
    email: zod_1.z.string().email().optional().or(zod_1.z.literal("")),
    password: zod_1.z.string().min(12).max(72).refine((value) => Buffer.byteLength(value, "utf8") <= 72, "La clave no debe superar 72 bytes"),
    role: zod_1.z.enum(["ADMIN", "FIREFIGHTER", "OPERATOR", "GUARD"]),
    fullName: zod_1.z.string().min(3).max(120),
    dni: zod_1.z.string().min(6).max(20),
    rank: zod_1.z.enum(firefighter_ranks_1.FIREFIGHTER_RANKS),
    badge: zod_1.z.string().min(1).max(30),
    birthDate: zod_1.z.string().optional().or(zod_1.z.literal("")),
    phone: zod_1.z.string().optional().or(zod_1.z.literal("")),
    altPhone: zod_1.z.string().optional().or(zod_1.z.literal("")),
    address: zod_1.z.string().optional().or(zod_1.z.literal("")),
    bloodType: zod_1.z.string().optional().or(zod_1.z.literal("")),
    joinDate: zod_1.z.string().optional().or(zod_1.z.literal("")),
    emergencyContact: zod_1.z
        .object({
        fullName: zod_1.z.string().min(2).max(120),
        phone: zod_1.z.string().min(3).max(40),
        relationship: zod_1.z.string().optional().or(zod_1.z.literal("")),
    })
        .optional(),
});
exports.updateUserSchema = zod_1.z.object({
    revision: zod_1.z.string().datetime().optional(),
    email: zod_1.z.string().email().optional().or(zod_1.z.literal("")),
    role: zod_1.z.enum(["ADMIN", "FIREFIGHTER", "OPERATOR", "GUARD"]).optional(),
    isActive: zod_1.z.boolean().optional(),
    fullName: zod_1.z.string().min(3).max(120).optional(),
    dni: zod_1.z.string().min(6).max(20).optional(),
    rank: zod_1.z.enum(firefighter_ranks_1.FIREFIGHTER_RANKS).optional(),
    badge: zod_1.z.string().min(1).max(30).optional(),
    birthDate: zod_1.z.string().optional().or(zod_1.z.literal("")),
    phone: zod_1.z.string().optional().or(zod_1.z.literal("")),
    altPhone: zod_1.z.string().optional().or(zod_1.z.literal("")),
    address: zod_1.z.string().optional().or(zod_1.z.literal("")),
    bloodType: zod_1.z.string().optional().or(zod_1.z.literal("")),
    joinDate: zod_1.z.string().optional().or(zod_1.z.literal("")),
    emergencyContact: zod_1.z
        .object({
        fullName: zod_1.z.string().min(2).max(120),
        phone: zod_1.z.string().min(3).max(40),
        relationship: zod_1.z.string().optional().or(zod_1.z.literal("")),
    })
        .optional(),
});
