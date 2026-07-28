"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.respondAlertSchema = exports.createAlertSchema = void 0;
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
    description: zod_1.z.string().optional(),
    contactPhone: zod_1.z.string().optional(),
});
exports.respondAlertSchema = zod_1.z.object({
    response: zod_1.z.enum(["GOING", "NOT_GOING"]),
});
