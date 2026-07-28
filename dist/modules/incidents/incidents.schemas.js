"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.assignUsersSchema = exports.closeIncidentSchema = exports.updateIncidentSchema = exports.createIncidentSchema = void 0;
const zod_1 = require("zod");
const alertTypeSchema = zod_1.z.enum([
    "FIRE",
    "RESCUE",
    "ACCIDENT",
    "CHEMICAL",
    "MEDICAL",
    "FLOOD",
    "OTHER",
]);
function ensureUniqueUsers(userIds, ctx) {
    if (!userIds)
        return;
    const uniqueIds = new Set(userIds);
    if (uniqueIds.size !== userIds.length) {
        ctx.addIssue({
            code: "custom",
            path: ["assignedUserIds"],
            message: "No se puede asignar dos veces al mismo usuario",
        });
    }
}
exports.createIncidentSchema = zod_1.z
    .object({
    alertId: zod_1.z.string().trim().optional().or(zod_1.z.literal("")),
    title: zod_1.z.string().trim().min(3).max(140),
    type: alertTypeSchema,
    description: zod_1.z.string().trim().min(3),
    losses: zod_1.z.string().trim().optional().or(zod_1.z.literal("")),
    assignedUserIds: zod_1.z.array(zod_1.z.string().min(1)).optional(),
})
    .superRefine((value, ctx) => {
    ensureUniqueUsers(value.assignedUserIds, ctx);
});
exports.updateIncidentSchema = zod_1.z
    .object({
    title: zod_1.z.string().trim().min(3).max(140).optional(),
    type: alertTypeSchema.optional(),
    description: zod_1.z.string().trim().min(3).optional(),
    losses: zod_1.z.string().trim().optional().or(zod_1.z.literal("")),
})
    .refine((value) => Object.keys(value).length > 0, {
    message: "Debe enviarse al menos un campo para actualizar",
});
exports.closeIncidentSchema = zod_1.z.object({});
exports.assignUsersSchema = zod_1.z
    .object({
    userIds: zod_1.z.array(zod_1.z.string().min(1)).min(1),
})
    .superRefine((value, ctx) => {
    ensureUniqueUsers(value.userIds, ctx);
});
