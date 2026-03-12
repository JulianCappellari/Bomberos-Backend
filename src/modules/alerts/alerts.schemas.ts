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
  description: z.string().optional(),
  contactPhone: z.string().optional(),
});

export const respondAlertSchema = z.object({
  response: z.enum(["GOING", "NOT_GOING"]),
});