import { z } from "zod";

export const createApplicationSchema = z.object({
  desiredUsername: z.string().min(3).max(50),
  email: z.string().email().optional().or(z.literal("")),
  dni: z.string().min(6).max(20),
  fullName: z.string().min(3).max(120),
  birthDate: z.string().optional().or(z.literal("")),
  phone: z.string().min(3).max(40),
  altPhone: z.string().optional().or(z.literal("")),
  address: z.string().min(3).max(180),
  bloodType: z.string().optional().or(z.literal("")),
  emergencyContactName: z.string().min(2).max(120),
  emergencyContactPhone: z.string().min(3).max(40),
  emergencyContactRelation: z.string().optional().or(z.literal("")),
  category: z.string().optional().or(z.literal("")),
  message: z.string().optional().or(z.literal("")),
});

export const rejectApplicationSchema = z.object({
  rejectReason: z.string().optional().or(z.literal("")),
});