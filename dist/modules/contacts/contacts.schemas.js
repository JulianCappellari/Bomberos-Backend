"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listContactsSchema = exports.deleteContactSchema = exports.updateContactSchema = exports.createContactSchema = void 0;
const zod_1 = require("zod");
const text = (max) => zod_1.z.string().trim().max(max).nullish();
const fields = zod_1.z.object({
    name: zod_1.z.string().trim().min(2).max(140),
    category: zod_1.z.string().trim().min(2).max(80),
    phone: text(40).refine((value) => !value || (/^\+?[\d\s().-]+$/.test(value) && value.replace(/\D/g, "").length >= 3), "Ingrese un telefono valido"),
    radioFrequency: text(80),
    email: zod_1.z.union([zod_1.z.email().max(120), zod_1.z.literal("")]).nullish(),
    address: text(200),
    notes: text(4000),
    isEmergency: zod_1.z.boolean().default(false),
});
function hasChannel(value) {
    return Boolean(value.phone || value.radioFrequency || value.email);
}
exports.createContactSchema = fields.refine(hasChannel, {
    path: ["phone"], message: "Ingrese telefono, frecuencia de radio o correo",
});
exports.updateContactSchema = fields.extend({
    revision: zod_1.z.number().int().min(1),
}).refine(hasChannel, {
    path: ["phone"], message: "Ingrese telefono, frecuencia de radio o correo",
});
exports.deleteContactSchema = zod_1.z.object({ revision: zod_1.z.coerce.number().int().min(1) });
exports.listContactsSchema = zod_1.z.object({
    q: zod_1.z.string().trim().max(140).optional(),
    category: zod_1.z.string().trim().max(80).optional(),
    emergency: zod_1.z.enum(["true", "false"]).optional(),
});
