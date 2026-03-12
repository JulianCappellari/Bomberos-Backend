import { z } from "zod";

export const createIncidentSchema = z.object({
  alertId: z.string().optional().or(z.literal("")),
  title: z.string().min(3).max(140),
  type: z.enum([
    "FIRE",
    "RESCUE",
    "ACCIDENT",
    "CHEMICAL",
    "MEDICAL",
    "FLOOD",
    "OTHER",
  ]),
  description: z.string().min(3),
  losses: z.string().optional().or(z.literal("")),
  assignedUserIds: z.array(z.string()).optional(),
});

export const updateIncidentSchema = z.object({
  title: z.string().min(3).max(140).optional(),
  type: z
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
  description: z.string().min(3).optional(),
  losses: z.string().optional().or(z.literal("")),
});

export const closeIncidentSchema = z.object({});
export const assignUsersSchema = z.object({
  userIds: z.array(z.string()).min(1),
});