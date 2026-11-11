import { z } from "zod";

export const listChatMessagesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  before: z.string().datetime().optional(),
});

// Solo enlaces web comunes: nada de javascript:, data: ni archivos locales.
const linkSchema = z.string().trim().max(500).url("Link inválido").refine((v) => /^https?:\/\//i.test(v), "El link debe empezar con http:// o https://");
export const createChatMessageSchema = z.object({
  // Puede ir vacio si el mensaje lleva fotos o links (como en WhatsApp).
  body: z.string().trim().max(1000).default(""),
  photos: z.array(z.string().min(1).max(260000)).max(3, "Máximo 3 fotos por mensaje").default([]),
  links: z.array(linkSchema).max(3, "Máximo 3 links por mensaje").default([]),
  audience: z.enum(["ALL", "COMMAND", "DRIVERS", "GUARD", "BOARD"]).default("ALL"),
  // Encuesta opcional: el texto del mensaje es la pregunta.
  poll: z.object({
    options: z.array(z.string().trim().min(1, "Las opciones no pueden estar vacías").max(120)).min(2, "Una encuesta necesita al menos 2 opciones").max(12, "Máximo 12 opciones"),
    allowMultiple: z.boolean().default(false),
  }).strict().optional(),
}).refine((v) => v.body.length > 0 || v.photos.length > 0 || v.links.length > 0, { message: "Escribí un mensaje o adjuntá una foto o un link", path: ["body"] })
  .refine((v) => !v.poll || (v.body.length > 0 && !v.photos.length), { message: "La encuesta necesita una pregunta y no lleva fotos", path: ["poll"] })
  .refine((v) => !v.poll || new Set(v.poll.options.map((o) => o.toLocaleLowerCase("es-AR"))).size === v.poll.options.length, { message: "Hay opciones repetidas", path: ["poll", "options"] });

export const votePollSchema = z.object({ optionIds: z.array(z.string().min(1).max(100)).max(12) }).strict();

export const updateChatMessageSchema = z.object({
  body: z.string().trim().min(1).max(1000),
});

export const pinChatMessageSchema = z.object({
  isPinned: z.boolean(),
});
