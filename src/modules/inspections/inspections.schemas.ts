import { z } from "zod";

export const inspectionItemSchema = z.object({
  inventoryItemId: z.string().min(1),
  expectedQuantity: z.number().int().min(1).optional(),
  result: z.enum(["OK", "MISSING", "DAMAGED", "UNCHECKED"]),
  observations: z.string().optional().or(z.literal("")),
});

export const createInspectionSchema = z.object({
  vehicleId: z.string().min(1),
  incidentType: z
    .enum([
      "FIRE",
      "RESCUE",
      "ACCIDENT",
      "CHEMICAL",
      "MEDICAL",
      "FLOOD",
      "OTHER",
    ])
    .optional(),
  inspectionDate: z.string().date(),
  inspectionTime: z.string().optional().or(z.literal("")),
  observations: z.string().optional().or(z.literal("")),
  items: z.array(inspectionItemSchema).min(1),
});