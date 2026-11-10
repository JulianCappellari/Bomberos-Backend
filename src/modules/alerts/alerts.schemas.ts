import { z } from "zod";

export const createAlertSchema = z.object({
  type: z.enum([
    "FIRE",
    "RESCUE",
    "ACCIDENT",
    "CHEMICAL",
    "MEDICAL",
    "FLOOD",
    "OTHER",
  ]),
  priority: z.enum(["HIGH", "MEDIUM", "LOW"]),
  location: z.string().min(4, "Location is required"),
  description: z.string().trim().min(1, "La descripción es obligatoria"),
  contactPhone: z.string().optional(),
});

export const respondAlertSchema = z.object({
  response: z.enum(["GOING", "NOT_GOING"]),
});

export const cancelAlertSchema = z.object({
  reason: z.string().trim().min(10, "El motivo debe tener al menos 10 caracteres").max(1000),
});