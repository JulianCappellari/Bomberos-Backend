import { z } from "zod";

export const createShiftSchema = z
  .object({
    date: z.string().date(),
    period: z.enum(["DAY", "NIGHT"]),
    notes: z.string().trim().max(4000).optional().or(z.literal("")),
    assignedUserIds: z.array(z.string().min(1)).min(1, "Seleccione al menos una persona"),
  })
  .superRefine((value, ctx) => {
    if (value.assignedUserIds) {
      const uniqueIds = new Set(value.assignedUserIds);
      if (uniqueIds.size !== value.assignedUserIds.length) {
        ctx.addIssue({
          code: "custom",
          path: ["assignedUserIds"],
          message: "No se puede asignar dos veces al mismo usuario",
        });
      }
    }
  });

export const updateShiftSchema = createShiftSchema;

export const listShiftsQuerySchema = z.object({
  date: z.string().date().optional(),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
}).refine((value) => !value.from || !value.to || value.from <= value.to, {
  path: ["to"],
  message: "La fecha final debe ser igual o posterior a la inicial",
});

export const assignUsersToShiftSchema = z.object({
  userIds: z.array(z.string().min(1)).min(1),
}).superRefine((value, ctx) => {
  const uniqueIds = new Set(value.userIds);
  if (uniqueIds.size !== value.userIds.length) {
    ctx.addIssue({
      code: "custom",
      path: ["userIds"],
      message: "No se puede asignar dos veces al mismo usuario",
    });
  }
});
