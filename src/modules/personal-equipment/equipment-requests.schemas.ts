import { z } from "zod";
import { equipmentCategories } from "./personal-equipment.schemas";
const revision = z.number().int().min(1).max(2147483646);
export const createEquipmentRequestSchema = z.object({ category: z.enum(equipmentCategories), size: z.string().trim().max(30).default(""), reason: z.string().trim().min(10).max(2000) });
export const editEquipmentRequestSchema = createEquipmentRequestSchema.extend({ revision });
export const reviewEquipmentRequestSchema = z.object({ revision, status: z.enum(["APPROVED", "REJECTED"]), notes: z.string().trim().min(10).max(2000) });
export const equipmentRequestListSchema = z.object({
  status: z.enum(["PENDING", "APPROVED", "REJECTED", "FULFILLED", "CANCELLED"]).optional(),
  userId: z.string().min(1).max(100).optional(), page: z.coerce.number().int().min(1).max(10000).default(1),
});
