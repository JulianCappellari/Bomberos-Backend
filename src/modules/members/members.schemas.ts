import { z } from "zod";
import { LICENSE_CLASS_CODES, normalizeLicenseClass } from "../../utils/license-classes";
// Cada clase de la licencia con sus propias fechas (otorgamiento y, si difiere, vencimiento).
const classItem = z.union([
  z.string().transform((code) => ({ code: normalizeLicenseClass(code), grantedOn: null as string | null, expiresOn: null as string | null })),
  z.object({ code: z.string().transform(normalizeLicenseClass), grantedOn: z.string().date().optional().nullable(), expiresOn: z.string().date().optional().nullable() }).strict().transform((v) => ({ code: v.code, grantedOn: v.grantedOn ?? null, expiresOn: v.expiresOn ?? null })),
]).refine((v) => (LICENSE_CLASS_CODES as readonly string[]).includes(v.code), "Clase de licencia inexistente: elegí una de la lista oficial (ej. B.1, C.1, D.4)");
export const personalProfileSchema = z.object({
  phone: z.string().trim().max(40), altPhone: z.string().trim().max(40), address: z.string().trim().max(180),
  bloodType: z.enum(["", "A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"]),
  emergencyContact: z.object({ fullName: z.string().trim().min(2).max(120), phone: z.string().trim().min(3).max(40), relationship: z.string().trim().max(60) }).strict(),
  email: z.string().trim().email().max(120).or(z.literal("")).optional(),
  revision: z.string().datetime({ offset: true }),
}).strict();
export const licenseSchema = z.object({
  number: z.string().trim().min(3).max(80), issuer: z.string().trim().min(3).max(160),
  // Cada numero de licencia corresponde a UNA clase: por formulario se carga una sola clase con sus datos.
  classes: z.array(classItem).length(1, "Cada licencia es de una sola clase: cargá un formulario por clase"),
  issuedOn: z.string().date(), expiresOn: z.string().date(),
}).strict().refine((value) => value.expiresOn >= value.issuedOn, "El vencimiento debe ser igual o posterior a la emision");
export const clothingSchema = z.object({ brand: z.string().trim().max(120), model: z.string().trim().max(120), size: z.string().trim().min(1).max(40), condition: z.enum(["OK", "REVIEW", "OUT", "UNKNOWN"]), novelties: z.string().trim().max(2000) }).strict();
const declarationFields = z.object({ category: z.enum(["CLOTHING", "DRIVER_LICENSE"]), title: z.string().trim().min(3).max(160), details: z.string().trim().min(3).max(4000), license: licenseSchema.optional(), clothing: clothingSchema.optional() }).strict();
const validDeclaration = (value: z.infer<typeof declarationFields>) => value.category === "DRIVER_LICENSE" ? Boolean(value.license) && !value.clothing : Boolean(value.clothing) && !value.license;
export const declarationSchema = declarationFields.refine(validDeclaration, "Complete los campos de licencia solo para una licencia de conducir");
export const declarationEditSchema = declarationFields.extend({ revision: z.number().int().positive() }).refine(validDeclaration, "Complete los datos estructurados de la licencia");
export const periodSchema = z.object({ startsAt: z.string().datetime({ offset: true }), endsAt: z.string().datetime({ offset: true }).nullable() }).strict().refine((v) => !v.endsAt || new Date(v.endsAt) > new Date(v.startsAt), "El fin debe ser posterior al inicio");
export const acknowledgementSchema = z.object({ contentHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
