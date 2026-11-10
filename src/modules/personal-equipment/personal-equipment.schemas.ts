import { z } from "zod";

export const equipmentCategories = ["HELMET", "COAT", "TROUSERS", "BOOTS", "GLOVES", "HOOD", "OTHER"] as const;
const revision = z.number().int().min(1).max(2147483646);
const notes = z.string().trim().max(2000);
export const createPersonalEquipmentSchema = z.object({
  code: z.string().trim().toUpperCase().min(2).max(40).regex(/^[A-Z0-9][A-Z0-9._/-]+$/),
  name: z.string().trim().min(3).max(140), category: z.enum(equipmentCategories), size: z.string().trim().max(30).default(""),
});
export const updatePersonalEquipmentSchema = createPersonalEquipmentSchema.omit({ code: true }).extend({ revision });
export const equipmentRevisionSchema = z.object({ revision });
export const issueEquipmentSchema = z.object({ revision, userId: z.string().min(1).max(100), notes: notes.default(""), requestId: z.string().min(1).max(100).optional(), requestRevision: revision.optional(), exceptionReason: z.string().trim().min(10).max(1000).optional() }).refine((input) => Boolean(input.requestId) === (input.requestRevision !== undefined), { message: "El pedido requiere su revision actual" });
export const returnEquipmentSchema = z.object({ revision, issueId: z.string().min(1).max(100), condition: z.enum(["OK", "REVIEW", "OUT"]), notes: notes.default("") }).refine((input) => input.condition === "OK" || input.notes.length >= 10, { path: ["notes"], message: "Describa la novedad con al menos 10 caracteres" });
export const checkEquipmentSchema = z.object({ revision, condition: z.enum(["OK", "REVIEW", "OUT"]), notes: notes.min(10) });
export const equipmentListSchema = z.object({
  q: z.string().trim().max(140).default(""), category: z.enum(equipmentCategories).optional(),
  view: z.enum(["all", "available", "assigned", "review", "archived", "mine"]).default("all"),
  page: z.coerce.number().int().min(1).max(10000).default(1),
});
export const equipmentHistorySchema = z.object({ page: z.coerce.number().int().min(1).max(10000).default(1) });
