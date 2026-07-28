import { z } from "zod";

export const createCompartmentSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(255).optional().nullable(),
  sortOrder: z.number().int().min(0).optional(),
}).strict();

export const createInventoryItemSchema = z.object({
  name: z.string().trim().min(1).max(140),
  expectedQuantity: z.number().int().min(1),
  state: z.enum(["OK", "REVIEW", "OUT"]).optional(),
  notes: z.string().trim().optional().nullable(),
}).strict();

export const updateInventoryItemSchema = z
  .object({
    compartmentId: z.string().min(1).optional(),
    name: z.string().trim().min(1).max(140).optional(),
    expectedQuantity: z.number().int().min(1).optional(),
    state: z.enum(["OK", "REVIEW", "OUT"]).optional(),
    notes: z.string().trim().optional().nullable(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Debe enviarse al menos un campo para actualizar",
  });

export const createInspectionSchema = z.object({
  vehicleId: z.string().min(1),
  incidentType: z
    .enum(["FIRE", "RESCUE", "ACCIDENT", "CHEMICAL", "MEDICAL", "FLOOD", "OTHER"])
    .optional()
    .nullable(),
  inspectionDate: z.string().datetime().optional(),
  inspectionTime: z.string().max(5).optional().nullable(),
  observations: z.string().optional().nullable(),
  responsibleUserIds: z.array(z.string().min(1)).min(1),
  items: z.array(
    z.object({
      inventoryItemId: z.string().min(1),
      result: z.enum(["OK", "MISSING", "DAMAGED", "UNCHECKED"]),
      observations: z.string().optional().nullable(),
    }),
  ).min(1),
}).strict();
