import { z } from "zod";

export const listChatMessagesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  before: z.string().datetime().optional(),
});

export const createChatMessageSchema = z.object({
  body: z.string().trim().min(1).max(1000),
  audience: z.enum(["ALL", "COMMAND", "DRIVERS", "GUARD", "BOARD"]).default("ALL"),
});

export const updateChatMessageSchema = z.object({
  body: z.string().trim().min(1).max(1000),
});

export const pinChatMessageSchema = z.object({
  isPinned: z.boolean(),
});
