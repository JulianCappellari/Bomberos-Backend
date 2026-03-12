import { z } from "zod";

export const createShiftSchema = z.object({
  date: z.string().date(),
  startTime: z.string().min(5).max(5),
  endTime: z.string().min(5).max(5),
  shiftType: z.string().min(2).max(60),
  notes: z.string().optional().or(z.literal("")),
  assignedUserIds: z.array(z.string()).optional(),
});

export const assignUsersToShiftSchema = z.object({
  userIds: z.array(z.string()).min(1),
});