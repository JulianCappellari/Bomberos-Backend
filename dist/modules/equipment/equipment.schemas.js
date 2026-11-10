"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateInventoryItemSchema = exports.createInventoryItemSchema = exports.createCompartmentSchema = exports.inventoryTemplateSchema = exports.compartmentOrderSchema = exports.compartmentDeleteSchema = exports.compartmentChangeSchema = void 0;
const zod_1 = require("zod");
const labelCode = zod_1.z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9._-]{0,39}$/, "Use letras, numeros, punto, guion o guion bajo").nullable().optional();
exports.compartmentChangeSchema = zod_1.z.object({ name: zod_1.z.string().trim().min(1).max(120), revision: zod_1.z.number().int().positive() }).strict();
exports.compartmentDeleteSchema = zod_1.z.object({ revision: zod_1.z.number().int().positive() }).strict();
exports.compartmentOrderSchema = zod_1.z.object({ compartments: zod_1.z.array(zod_1.z.object({ id: zod_1.z.string().min(1), revision: zod_1.z.number().int().positive() }).strict()).min(1).max(100) }).strict().refine((v) => new Set(v.compartments.map((c) => c.id)).size === v.compartments.length, "No repita compartimentos");
exports.inventoryTemplateSchema = zod_1.z.object({ template: zod_1.z.enum(["ENGINE", "SUPPORT"]), confirm: zod_1.z.literal(true) }).strict();
exports.createCompartmentSchema = zod_1.z.object({
    name: zod_1.z.string().trim().min(1).max(120),
    description: zod_1.z.string().trim().max(255).optional().nullable(),
    sortOrder: zod_1.z.number().int().min(0).optional(),
}).strict();
exports.createInventoryItemSchema = zod_1.z.object({
    name: zod_1.z.string().trim().min(1).max(140),
    expectedQuantity: zod_1.z.number().int().min(1).max(100000),
    labelCode,
    expiresOn: zod_1.z.string().date().nullable().optional(),
    state: zod_1.z.enum(["OK", "REVIEW", "OUT"]).optional(),
    notes: zod_1.z.string().trim().max(4000).optional().nullable(),
}).strict();
exports.updateInventoryItemSchema = zod_1.z
    .object({
    revision: zod_1.z.number().int().positive(),
    labelCode,
    expiresOn: zod_1.z.string().date().nullable().optional(),
    compartmentId: zod_1.z.string().min(1).optional(),
    name: zod_1.z.string().trim().min(1).max(140).optional(),
    expectedQuantity: zod_1.z.number().int().min(1).max(100000).optional(),
    state: zod_1.z.enum(["OK", "REVIEW", "OUT"]).optional(),
    notes: zod_1.z.string().trim().max(4000).optional().nullable(),
})
    .strict()
    .refine((value) => Object.keys(value).some((key) => key !== "revision"), {
    message: "Debe enviarse al menos un campo para actualizar",
});
