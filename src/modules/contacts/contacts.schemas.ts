import { z } from "zod";

const text = (max: number) => z.string().trim().max(max).nullish();
const fields = z.object({
  name: z.string().trim().min(2).max(140),
  category: z.string().trim().min(2).max(80),
  phone: text(40).refine(
    (value) => !value || (/^\+?[\d\s().-]+$/.test(value) && value.replace(/\D/g, "").length >= 3),
    "Ingrese un telefono valido",
  ),
  radioFrequency: text(80),
  email: z.union([z.email().max(120), z.literal("")]).nullish(),
  address: text(200),
  notes: text(4000),
  isEmergency: z.boolean().default(false),
});

function hasChannel(value: { phone?: string | null; radioFrequency?: string | null; email?: string | null }) {
  return Boolean(value.phone || value.radioFrequency || value.email);
}

export const createContactSchema = fields.refine(hasChannel, {
  path: ["phone"], message: "Ingrese telefono, frecuencia de radio o correo",
});
export const updateContactSchema = fields.extend({
  revision: z.number().int().min(1),
}).refine(hasChannel, {
  path: ["phone"], message: "Ingrese telefono, frecuencia de radio o correo",
});
export const deleteContactSchema = z.object({ revision: z.coerce.number().int().min(1) });
export const listContactsSchema = z.object({
  q: z.string().trim().max(140).optional(),
  category: z.string().trim().max(80).optional(),
  emergency: z.enum(["true", "false"]).optional(),
});

export type ContactInput = z.infer<typeof createContactSchema>;
