"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.acknowledgementSchema = exports.periodSchema = exports.declarationEditSchema = exports.declarationSchema = exports.clothingSchema = exports.licenseSchema = exports.personalProfileSchema = void 0;
const zod_1 = require("zod");
exports.personalProfileSchema = zod_1.z.object({
    phone: zod_1.z.string().trim().max(40), altPhone: zod_1.z.string().trim().max(40), address: zod_1.z.string().trim().max(180),
    bloodType: zod_1.z.enum(["", "A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"]),
    emergencyContact: zod_1.z.object({ fullName: zod_1.z.string().trim().min(2).max(120), phone: zod_1.z.string().trim().min(3).max(40), relationship: zod_1.z.string().trim().max(60) }).strict(),
    email: zod_1.z.string().trim().email().max(120).or(zod_1.z.literal("")).optional(),
    revision: zod_1.z.string().datetime({ offset: true }),
}).strict();
exports.licenseSchema = zod_1.z.object({
    number: zod_1.z.string().trim().min(3).max(80), issuer: zod_1.z.string().trim().min(3).max(160),
    classes: zod_1.z.array(zod_1.z.string().trim().toUpperCase().regex(/^[A-Z0-9.]{1,12}$/)).min(1).max(15).refine((values) => new Set(values).size === values.length, "No repita clases"),
    issuedOn: zod_1.z.string().date(), expiresOn: zod_1.z.string().date(),
}).strict().refine((value) => value.expiresOn >= value.issuedOn, "El vencimiento debe ser igual o posterior a la emision");
exports.clothingSchema = zod_1.z.object({ brand: zod_1.z.string().trim().max(120), model: zod_1.z.string().trim().max(120), size: zod_1.z.string().trim().min(1).max(40), condition: zod_1.z.enum(["OK", "REVIEW", "OUT", "UNKNOWN"]), novelties: zod_1.z.string().trim().max(2000) }).strict();
const declarationFields = zod_1.z.object({ category: zod_1.z.enum(["CLOTHING", "DRIVER_LICENSE"]), title: zod_1.z.string().trim().min(3).max(160), details: zod_1.z.string().trim().min(3).max(4000), license: exports.licenseSchema.optional(), clothing: exports.clothingSchema.optional() }).strict();
const validDeclaration = (value) => value.category === "DRIVER_LICENSE" ? Boolean(value.license) && !value.clothing : Boolean(value.clothing) && !value.license;
exports.declarationSchema = declarationFields.refine(validDeclaration, "Complete los campos de licencia solo para una licencia de conducir");
exports.declarationEditSchema = declarationFields.extend({ revision: zod_1.z.number().int().positive() }).refine(validDeclaration, "Complete los datos estructurados de la licencia");
exports.periodSchema = zod_1.z.object({ startsAt: zod_1.z.string().datetime({ offset: true }), endsAt: zod_1.z.string().datetime({ offset: true }).nullable() }).strict().refine((v) => !v.endsAt || new Date(v.endsAt) > new Date(v.startsAt), "El fin debe ser posterior al inicio");
exports.acknowledgementSchema = zod_1.z.object({ contentHash: zod_1.z.string().regex(/^[a-f0-9]{64}$/) }).strict();
