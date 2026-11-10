"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.equipmentHistorySchema = exports.equipmentListSchema = exports.checkEquipmentSchema = exports.returnEquipmentSchema = exports.issueEquipmentSchema = exports.equipmentRevisionSchema = exports.updatePersonalEquipmentSchema = exports.createPersonalEquipmentSchema = exports.equipmentCategories = void 0;
const zod_1 = require("zod");
exports.equipmentCategories = ["HELMET", "COAT", "TROUSERS", "BOOTS", "GLOVES", "HOOD", "OTHER"];
const revision = zod_1.z.number().int().min(1).max(2147483646);
const notes = zod_1.z.string().trim().max(2000);
exports.createPersonalEquipmentSchema = zod_1.z.object({
    code: zod_1.z.string().trim().toUpperCase().min(2).max(40).regex(/^[A-Z0-9][A-Z0-9._/-]+$/),
    name: zod_1.z.string().trim().min(3).max(140), category: zod_1.z.enum(exports.equipmentCategories), size: zod_1.z.string().trim().max(30).default(""),
});
exports.updatePersonalEquipmentSchema = exports.createPersonalEquipmentSchema.omit({ code: true }).extend({ revision });
exports.equipmentRevisionSchema = zod_1.z.object({ revision });
exports.issueEquipmentSchema = zod_1.z.object({ revision, userId: zod_1.z.string().min(1).max(100), notes: notes.default(""), requestId: zod_1.z.string().min(1).max(100).optional(), requestRevision: revision.optional(), exceptionReason: zod_1.z.string().trim().min(10).max(1000).optional() }).refine((input) => Boolean(input.requestId) === (input.requestRevision !== undefined), { message: "El pedido requiere su revision actual" });
exports.returnEquipmentSchema = zod_1.z.object({ revision, issueId: zod_1.z.string().min(1).max(100), condition: zod_1.z.enum(["OK", "REVIEW", "OUT"]), notes: notes.default("") }).refine((input) => input.condition === "OK" || input.notes.length >= 10, { path: ["notes"], message: "Describa la novedad con al menos 10 caracteres" });
exports.checkEquipmentSchema = zod_1.z.object({ revision, condition: zod_1.z.enum(["OK", "REVIEW", "OUT"]), notes: notes.min(10) });
exports.equipmentListSchema = zod_1.z.object({
    q: zod_1.z.string().trim().max(140).default(""), category: zod_1.z.enum(exports.equipmentCategories).optional(),
    view: zod_1.z.enum(["all", "available", "assigned", "review", "archived", "mine"]).default("all"),
    page: zod_1.z.coerce.number().int().min(1).max(10000).default(1),
});
exports.equipmentHistorySchema = zod_1.z.object({ page: zod_1.z.coerce.number().int().min(1).max(10000).default(1) });
