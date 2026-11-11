import { z } from "zod";

export const listChatMessagesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  before: z.string().datetime().optional(),
});

export const createChatMessageSchema = z.object({
  body: z.string().trim().min(1).max(1000),
  audience: z.enum(["ALL", "COMMAND", "DRIVERS", "GUARD", "BOARD"]).default("ALL"),
  // Encuesta opcional: el texto del mensaje es la pregunta.
  poll: z.object({
    options: z.array(z.string().trim().min(1, "Las opciones no pueden estar vacías").max(120)).min(2, "Una encuesta necesita al menos 2 opciones").max(12, "Máximo 12 opciones"),
    allowMultiple: z.boolean().default(false),
  }).strict().optional(),
}).refine((v) => !v.poll || new Set(v.poll.options.map((o) => o.toLocaleLowerCase("es-AR"))).size === v.poll.options.length, { message: "Hay opciones repetidas", path: ["poll", "options"] });

export const votePollSchema = z.object({ optionIds: z.array(z.string().min(1).max(100)).max(12) }).strict();

export const updateChatMessageSchema = z.object({
  body: z.string().trim().min(1).max(1000),
});

export const pinChatMessageSchema = z.object({
  isPinned: z.boolean(),
});
