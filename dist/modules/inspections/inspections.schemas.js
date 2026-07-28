"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createInspectionSchema = exports.inspectionItemSchema = void 0;
const zod_1 = require("zod");
exports.inspectionItemSchema = zod_1.z.object({
    inventoryItemId: zod_1.z.string().min(1),
    expectedQuantity: zod_1.z.number().int().min(1).optional(),
    result: zod_1.z.enum(["OK", "MISSING", "DAMAGED", "UNCHECKED"]),
    observations: zod_1.z.string().optional().or(zod_1.z.literal("")),
});
exports.createInspectionSchema = zod_1.z.object({
    vehicleId: zod_1.z.string().min(1),
    incidentType: zod_1.z
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
    inspectionDate: zod_1.z.string().date(),
    inspectionTime: zod_1.z.string().max(5).optional().or(zod_1.z.literal("")),
    observations: zod_1.z.string().optional().or(zod_1.z.literal("")),
    items: zod_1.z.array(exports.inspectionItemSchema).min(1),
});
