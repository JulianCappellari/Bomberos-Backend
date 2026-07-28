"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createInspectionSchema = exports.updateInventoryItemSchema = exports.createInventoryItemSchema = exports.createCompartmentSchema = void 0;
const zod_1 = require("zod");
exports.createCompartmentSchema = zod_1.z.object({
    name: zod_1.z.string().trim().min(1).max(120),
    description: zod_1.z.string().trim().max(255).optional().nullable(),
    sortOrder: zod_1.z.number().int().min(0).optional(),
}).strict();
exports.createInventoryItemSchema = zod_1.z.object({
    name: zod_1.z.string().trim().min(1).max(140),
    expectedQuantity: zod_1.z.number().int().min(1),
    state: zod_1.z.enum(["OK", "REVIEW", "OUT"]).optional(),
    notes: zod_1.z.string().trim().optional().nullable(),
}).strict();
exports.updateInventoryItemSchema = zod_1.z
    .object({
    compartmentId: zod_1.z.string().min(1).optional(),
    name: zod_1.z.string().trim().min(1).max(140).optional(),
    expectedQuantity: zod_1.z.number().int().min(1).optional(),
    state: zod_1.z.enum(["OK", "REVIEW", "OUT"]).optional(),
    notes: zod_1.z.string().trim().optional().nullable(),
})
    .strict()
    .refine((value) => Object.keys(value).length > 0, {
    message: "Debe enviarse al menos un campo para actualizar",
});
exports.createInspectionSchema = zod_1.z.object({
    vehicleId: zod_1.z.string().min(1),
    incidentType: zod_1.z
        .enum(["FIRE", "RESCUE", "ACCIDENT", "CHEMICAL", "MEDICAL", "FLOOD", "OTHER"])
        .optional()
        .nullable(),
    inspectionDate: zod_1.z.string().datetime().optional(),
    inspectionTime: zod_1.z.string().max(5).optional().nullable(),
    observations: zod_1.z.string().optional().nullable(),
    responsibleUserIds: zod_1.z.array(zod_1.z.string().min(1)).min(1),
    items: zod_1.z.array(zod_1.z.object({
        inventoryItemId: zod_1.z.string().min(1),
        result: zod_1.z.enum(["OK", "MISSING", "DAMAGED", "UNCHECKED"]),
        observations: zod_1.z.string().optional().nullable(),
    })).min(1),
}).strict();
