"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cancelAlertSchema = exports.respondAlertSchema = exports.createAlertSchema = void 0;
const zod_1 = require("zod");
exports.createAlertSchema = zod_1.z.object({
    type: zod_1.z.enum([
        "FIRE",
        "RESCUE",
        "ACCIDENT",
        "CHEMICAL",
        "MEDICAL",
        "FLOOD",
        "OTHER",
    ]),
    priority: zod_1.z.enum(["HIGH", "MEDIUM", "LOW"]),
    location: zod_1.z.string().min(4, "Location is required"),
    description: zod_1.z.string().trim().min(1, "La descripción es obligatoria"),
    contactPhone: zod_1.z.string().optional(),
});
exports.respondAlertSchema = zod_1.z.object({
    response: zod_1.z.enum(["GOING", "NOT_GOING"]),
});
exports.cancelAlertSchema = zod_1.z.object({
    reason: zod_1.z.string().trim().min(10, "El motivo debe tener al menos 10 caracteres").max(1000),
});
