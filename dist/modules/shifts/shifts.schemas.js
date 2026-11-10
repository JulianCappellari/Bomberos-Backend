"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.assignUsersToShiftSchema = exports.listShiftsQuerySchema = exports.updateShiftSchema = exports.createShiftSchema = void 0;
const zod_1 = require("zod");
exports.createShiftSchema = zod_1.z
    .object({
    date: zod_1.z.string().date(),
    period: zod_1.z.enum(["DAY", "NIGHT"]),
    notes: zod_1.z.string().trim().max(4000).optional().or(zod_1.z.literal("")),
    assignedUserIds: zod_1.z.array(zod_1.z.string().min(1)).min(1, "Seleccione al menos una persona"),
})
    .superRefine((value, ctx) => {
    if (value.assignedUserIds) {
        const uniqueIds = new Set(value.assignedUserIds);
        if (uniqueIds.size !== value.assignedUserIds.length) {
            ctx.addIssue({
                code: "custom",
                path: ["assignedUserIds"],
                message: "No se puede asignar dos veces al mismo usuario",
            });
        }
    }
});
exports.updateShiftSchema = exports.createShiftSchema;
exports.listShiftsQuerySchema = zod_1.z.object({
    date: zod_1.z.string().date().optional(),
    from: zod_1.z.string().date().optional(),
    to: zod_1.z.string().date().optional(),
}).refine((value) => !value.from || !value.to || value.from <= value.to, {
    path: ["to"],
    message: "La fecha final debe ser igual o posterior a la inicial",
});
exports.assignUsersToShiftSchema = zod_1.z.object({
    userIds: zod_1.z.array(zod_1.z.string().min(1)).min(1),
}).superRefine((value, ctx) => {
    const uniqueIds = new Set(value.userIds);
    if (uniqueIds.size !== value.userIds.length) {
        ctx.addIssue({
            code: "custom",
            path: ["userIds"],
            message: "No se puede asignar dos veces al mismo usuario",
        });
    }
});
