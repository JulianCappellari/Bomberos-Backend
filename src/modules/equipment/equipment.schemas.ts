import { z } from "zod";

const labelCode = z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9._-]{0,39}$/, "Use letras, numeros, punto, guion o guion bajo").nullable().optional();
export const compartmentChangeSchema = z.object({ name: z.string().trim().min(1).max(120), revision: z.number().int().positive() }).strict();
export const compartmentDeleteSchema = z.object({ revision: z.number().int().positive() }).strict();
export const compartmentOrderSchema = z.object({ compartments: z.array(z.object({ id: z.string().min(1), revision: z.number().int().positive() }).strict()).min(1).max(100) }).strict().refine((v) => new Set(v.compartments.map((c) => c.id)).size === v.compartments.length, "No repita compartimentos");
export const inventoryTemplateSchema = z.object({ template: z.enum(["ENGINE", "SUPPORT"]), confirm: z.literal(true) }).strict();

export const createCompartmentSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(255).optional().nullable(),
  sortOrder: z.number().int().min(0).optional(),
}).strict();

export const createInventoryItemSchema = z.object({
  name: z.string().trim().min(1).max(140),
  expectedQuantity: z.number().int().min(1).max(100000),
  labelCode,
  expiresOn: z.string().date().nullable().optional(),
  state: z.enum(["OK", "REVIEW", "OUT"]).optional(),
  notes: z.string().trim().max(4000).optional().nullable(),
}).strict();

export const updateInventoryItemSchema = z
  .object({
    revision: z.number().int().positive(),
    labelCode,
    expiresOn: z.string().date().nullable().optional(),
    compartmentId: z.string().min(1).optional(),
    name: z.string().trim().min(1).max(140).optional(),
    expectedQuantity: z.number().int().min(1).max(100000).optional(),
    state: z.enum(["OK", "REVIEW", "OUT"]).optional(),
    notes: z.string().trim().max(4000).optional().nullable(),
  })
  .strict()
  .refine((value) => Object.keys(value).some((key) => key !== "revision"), {
    message: "Debe enviarse al menos un campo para actualizar",
  });
