"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.equipmentRequestListSchema = exports.reviewEquipmentRequestSchema = exports.editEquipmentRequestSchema = exports.createEquipmentRequestSchema = void 0;
const zod_1 = require("zod");
const personal_equipment_schemas_1 = require("./personal-equipment.schemas");
const revision = zod_1.z.number().int().min(1).max(2147483646);
exports.createEquipmentRequestSchema = zod_1.z.object({ category: zod_1.z.enum(personal_equipment_schemas_1.equipmentCategories), size: zod_1.z.string().trim().max(30).default(""), reason: zod_1.z.string().trim().min(10).max(2000) });
exports.editEquipmentRequestSchema = exports.createEquipmentRequestSchema.extend({ revision });
exports.reviewEquipmentRequestSchema = zod_1.z.object({ revision, status: zod_1.z.enum(["APPROVED", "REJECTED"]), notes: zod_1.z.string().trim().min(10).max(2000) });
exports.equipmentRequestListSchema = zod_1.z.object({
    status: zod_1.z.enum(["PENDING", "APPROVED", "REJECTED", "FULFILLED", "CANCELLED"]).optional(),
    userId: zod_1.z.string().min(1).max(100).optional(), page: zod_1.z.coerce.number().int().min(1).max(10000).default(1),
});
