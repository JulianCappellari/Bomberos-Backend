import { z } from "zod";

export const inspectionItemSchema = z.object({
  foundElsewhere: z.boolean().default(false),
  foundLocation: z.string().trim().min(3).max(200).nullable().optional(),
  inventoryItemId: z.string().min(1),
  observedQuantity: z.number().int().min(0),
  result: z.enum(["OK", "MISSING", "DAMAGED"]),
  observations: z.string().trim().max(4000).nullish(),
}).refine((v) => v.foundElsewhere ? Boolean(v.foundLocation) && v.observedQuantity > 0 : !v.foundLocation, "Indique el lugar donde encontro el material; un material ausente no puede estar en otro lugar");

export const createInspectionSchema = z.object({
  draftId:z.string().min(1).optional(),
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
  inspectionTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Ingrese una hora valida"),
  observations: z.string().trim().max(10000).nullish(),
  sectionComments: z.array(z.object({ compartmentId: z.string().min(1).max(100), observations: z.string().trim().max(2000) })).max(100).default([]),
  // Fluidos revisados en el control (opcional en la API por compatibilidad; la app los exige).
  fluids: z.object({
    oil: z.enum(["OK", "LOW", "ADDED"]),
    coolant: z.enum(["OK", "LOW", "ADDED"]),
    fuel: z.enum(["FULL", "THREE_QUARTERS", "HALF", "QUARTER", "RESERVE"]),
  }).strict().optional(),
  leaderUserId: z.string().min(1),
  responsibleUserIds: z.array(z.string().min(1)).min(1),
  items: z.array(inspectionItemSchema).min(1),
}).superRefine((value, ctx) => {
  const responsibleIds = new Set(value.responsibleUserIds);
  if (responsibleIds.size !== value.responsibleUserIds.length) {
    ctx.addIssue({ code: "custom", path: ["responsibleUserIds"], message: "Hay personas repetidas" });
  }
  if (!responsibleIds.has(value.leaderUserId)) {
    ctx.addIssue({ code: "custom", path: ["leaderUserId"], message: "El encargado debe integrar el equipo de control" });
  }
  const itemIds = value.items.map((item) => item.inventoryItemId);
  if (new Set(itemIds).size !== itemIds.length) {
    ctx.addIssue({ code: "custom", path: ["items"], message: "Hay materiales repetidos en el control" });
  }
});
