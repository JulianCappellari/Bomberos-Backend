import { z } from "zod";

const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, {
  message: "El horario debe tener formato HH:mm",
});

function timeToMinutes(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

export const createShiftSchema = z
  .object({
    date: z.string().date(),
    startTime: timeSchema,
    endTime: timeSchema,
    shiftType: z.string().trim().min(2).max(60),
    notes: z.string().trim().optional().or(z.literal("")),
    assignedUserIds: z.array(z.string().min(1)).optional(),
  })
  .superRefine((value, ctx) => {
    if (timeToMinutes(value.endTime) <= timeToMinutes(value.startTime)) {
      ctx.addIssue({
        code: "custom",
        path: ["endTime"],
        message: "La hora de fin debe ser posterior a la hora de inicio",
      });
    }

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

export const listShiftsQuerySchema = z.object({
  date: z.string().date().optional(),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
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
