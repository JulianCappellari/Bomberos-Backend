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
    losses: z.string().trim().optional().or(z.literal("")),
    assignedUserIds: z.array(z.string().min(1)).optional(),
  })
  .superRefine((value, ctx) => {
    ensureUniqueUsers(value.assignedUserIds, ctx);
  });

export const updateIncidentSchema = z
  .object({
    title: z.string().trim().min(3).max(140).optional(),
    type: alertTypeSchema.optional(),
    description: z.string().trim().min(3).optional(),
    losses: z.string().trim().optional().or(z.literal("")),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Debe enviarse al menos un campo para actualizar",
  });

export const closeIncidentSchema = z.object({});
export const assignUsersSchema = z
  .object({
    userIds: z.array(z.string().min(1)).min(1),
  })
  .superRefine((value, ctx) => {
    ensureUniqueUsers(value.userIds, ctx);
  });
