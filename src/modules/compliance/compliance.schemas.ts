import { z } from "zod";

export const complianceSubjectTypeSchema = z.enum(["USER", "ASSET"]);
export const complianceCategorySchema = z.enum([
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

const optionalDate = z.string().date().optional().or(z.literal(""));
const optionalText = (max: number) =>
  z.string().trim().max(max).optional().or(z.literal(""));

export const complianceRecordInputSchema = z
  .object({
    subjectType: complianceSubjectTypeSchema,
    userId: z.string().trim().optional().or(z.literal("")),
    assetId: z.string().trim().optional().or(z.literal("")),
    category: complianceCategorySchema,
    title: z.string().trim().min(3).max(140),
    issuer: optionalText(140),
    issuedAt: optionalDate,
    expiresAt: optionalDate,
    warningDays: z.coerce.number().int().min(0).max(3650).default(30),
    documentUrl: z.string().trim().url().max(500).optional().or(z.literal("")),
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

export const updateComplianceRecordSchema = complianceRecordInputSchema;

export const listComplianceRecordsSchema = z.object({
  subjectType: complianceSubjectTypeSchema.optional(),
  category: complianceCategorySchema.optional(),
  status: z.enum(["VALID", "DUE_SOON", "EXPIRED", "NO_EXPIRY"]).optional(),
  userId: z.string().trim().min(1).optional(),
  assetId: z.string().trim().min(1).optional(),
  q: z.string().trim().min(1).max(120).optional(),
});
