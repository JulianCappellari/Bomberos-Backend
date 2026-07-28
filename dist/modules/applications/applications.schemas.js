"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.rejectApplicationSchema = exports.createApplicationSchema = void 0;
const zod_1 = require("zod");
exports.createApplicationSchema = zod_1.z.object({
    desiredUsername: zod_1.z.string().min(3).max(50),
    email: zod_1.z.string().email().optional().or(zod_1.z.literal("")),
    dni: zod_1.z.string().min(6).max(20),
    fullName: zod_1.z.string().min(3).max(120),
    birthDate: zod_1.z.string().optional().or(zod_1.z.literal("")),
    phone: zod_1.z.string().min(3).max(40),
    altPhone: zod_1.z.string().optional().or(zod_1.z.literal("")),
    address: zod_1.z.string().min(3).max(180),
    bloodType: zod_1.z.string().optional().or(zod_1.z.literal("")),
    emergencyContactName: zod_1.z.string().min(2).max(120),
    emergencyContactPhone: zod_1.z.string().min(3).max(40),
    emergencyContactRelation: zod_1.z.string().optional().or(zod_1.z.literal("")),
    category: zod_1.z.string().optional().or(zod_1.z.literal("")),
    message: zod_1.z.string().optional().or(zod_1.z.literal("")),
});
exports.rejectApplicationSchema = zod_1.z.object({
    rejectReason: zod_1.z.string().optional().or(zod_1.z.literal("")),
});
