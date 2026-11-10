"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listComplianceRecordsSchema = exports.updateComplianceRecordSchema = exports.complianceRecordInputSchema = exports.complianceCategorySchema = exports.complianceSubjectTypeSchema = void 0;
const zod_1 = require("zod");
exports.complianceSubjectTypeSchema = zod_1.z.enum(["USER", "ASSET"]);
exports.complianceCategorySchema = zod_1.z.enum([
    "TRAINING",
    "CERTIFICATION",
    "MEDICAL_EXAM",
    "DRIVER_LICENSE",
    "INSURANCE",
    "VTV",
    "SERVICE",
    "SCBA_SERVICE",
    "OTHER",
]);
const optionalDate = zod_1.z.string().date().optional().or(zod_1.z.literal(""));
const optionalText = (max) => zod_1.z.string().trim().max(max).optional().or(zod_1.z.literal(""));
exports.complianceRecordInputSchema = zod_1.z
    .object({
    subjectType: exports.complianceSubjectTypeSchema,
    userId: zod_1.z.string().trim().optional().or(zod_1.z.literal("")),
    assetId: zod_1.z.string().trim().optional().or(zod_1.z.literal("")),
    category: exports.complianceCategorySchema,
    title: zod_1.z.string().trim().min(3).max(140),
    issuer: optionalText(140),
    issuedAt: optionalDate,
    expiresAt: optionalDate,
    warningDays: zod_1.z.coerce.number().int().min(0).max(3650).default(30),
    documentUrl: zod_1.z.string().trim().url().max(500).optional().or(zod_1.z.literal("")),
    notes: optionalText(4000),
})
    .superRefine((value, ctx) => {
    if (value.subjectType === "USER" && !value.userId) {
        ctx.addIssue({
            code: "custom",
            path: ["userId"],
            message: "Debe seleccionar un bombero",
        });
    }
    if (value.subjectType === "ASSET" && !value.assetId) {
        ctx.addIssue({
            code: "custom",
            path: ["assetId"],
            message: "Debe seleccionar un vehiculo o equipo",
        });
    }
    if (value.issuedAt && value.expiresAt && value.expiresAt < value.issuedAt) {
        ctx.addIssue({
            code: "custom",
            path: ["expiresAt"],
            message: "El vencimiento no puede ser anterior a la emision",
        });
    }
});
exports.updateComplianceRecordSchema = exports.complianceRecordInputSchema;
exports.listComplianceRecordsSchema = zod_1.z.object({
    subjectType: exports.complianceSubjectTypeSchema.optional(),
    category: exports.complianceCategorySchema.optional(),
    status: zod_1.z.enum(["VALID", "DUE_SOON", "EXPIRED", "NO_EXPIRY"]).optional(),
    userId: zod_1.z.string().trim().min(1).optional(),
    assetId: zod_1.z.string().trim().min(1).optional(),
    q: zod_1.z.string().trim().min(1).max(120).optional(),
});
