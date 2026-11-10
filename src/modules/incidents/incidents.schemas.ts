import { z } from "zod";

const alertTypeSchema = z.enum([
  "FIRE",
  "RESCUE",
  "ACCIDENT",
  "CHEMICAL",
  "MEDICAL",
  "FLOOD",
  "OTHER",
]);

function ensureUniqueUsers(userIds: string[] | undefined, ctx: z.RefinementCtx) {
  if (!userIds) return;

  const uniqueIds = new Set(userIds);
  if (uniqueIds.size !== userIds.length) {
    ctx.addIssue({
      code: "custom",
      path: ["assignedUserIds"],
      message: "No se puede asignar dos veces al mismo usuario",
    });
  }
}

export const createIncidentSchema = z
  .object({
    alertId: z.string().trim().optional().or(z.literal("")),
    title: z.string().trim().min(3).max(140),
    type: alertTypeSchema,
    description: z.string().trim().min(3),
    location: z.string().trim().min(3).max(180),
    responseTimeMinutes: z.coerce.number().int().min(1).max(999).optional(),
    losses: z.string().trim().optional().or(z.literal("")),
    assignedUserIds: z.array(z.string().min(1)).optional(),
    vehicleAssetIds: z.array(z.string().min(1)).optional(),
  })
  .superRefine((value, ctx) => {
    ensureUniqueUsers(value.assignedUserIds, ctx);
  });

export const updateIncidentSchema = z
  .object({
    title: z.string().trim().min(3).max(140).optional(),
    type: alertTypeSchema.optional(),
    description: z.string().trim().min(3).optional(),
    location: z.string().trim().min(3).max(180).optional(),
    responseTimeMinutes: z.coerce.number().int().min(1).max(999).nullable().optional(),
    losses: z.string().trim().optional().or(z.literal("")),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Debe enviarse al menos un campo para actualizar",
  });

export const closeIncidentSchema = z.object({
  responseTimeMinutes: z.coerce.number().int().min(1).max(999).optional(),
  closingReport: z.string().trim().min(10).max(10000),
});

export const createIncidentUpdateSchema = z.object({
  body: z.string().trim().min(3).max(4000),
});
export const assignUsersSchema = z
  .object({
    userIds: z.array(z.string().min(1)).min(1),
  })
  .superRefine((value, ctx) => {
    ensureUniqueUsers(value.userIds, ctx);
  });

export const dispatchAlertSchema = z.object({
  title: z.string().trim().min(3).max(140).optional(),
  description: z.string().trim().min(3).max(4000).optional(),
  autoAssignResponders: z.boolean().default(true),
});
