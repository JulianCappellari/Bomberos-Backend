"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dispatchAlertSchema = exports.assignUsersSchema = exports.createIncidentUpdateSchema = exports.closeIncidentSchema = exports.updateIncidentSchema = exports.createIncidentSchema = void 0;
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
    location: zod_1.z.string().trim().min(3).max(180),
    responseTimeMinutes: zod_1.z.coerce.number().int().min(1).max(999).optional(),
    losses: zod_1.z.string().trim().optional().or(zod_1.z.literal("")),
    assignedUserIds: zod_1.z.array(zod_1.z.string().min(1)).optional(),
    vehicleAssetIds: zod_1.z.array(zod_1.z.string().min(1)).optional(),
})
    .superRefine((value, ctx) => {
    ensureUniqueUsers(value.assignedUserIds, ctx);
});
exports.updateIncidentSchema = zod_1.z
    .object({
    title: zod_1.z.string().trim().min(3).max(140).optional(),
    type: alertTypeSchema.optional(),
    description: zod_1.z.string().trim().min(3).optional(),
    location: zod_1.z.string().trim().min(3).max(180).optional(),
    responseTimeMinutes: zod_1.z.coerce.number().int().min(1).max(999).nullable().optional(),
    losses: zod_1.z.string().trim().optional().or(zod_1.z.literal("")),
})
    .refine((value) => Object.keys(value).length > 0, {
    message: "Debe enviarse al menos un campo para actualizar",
});
exports.closeIncidentSchema = zod_1.z.object({
    responseTimeMinutes: zod_1.z.coerce.number().int().min(1).max(999).optional(),
    closingReport: zod_1.z.string().trim().min(10).max(10000),
});
exports.createIncidentUpdateSchema = zod_1.z.object({
    body: zod_1.z.string().trim().min(3).max(4000),
});
exports.assignUsersSchema = zod_1.z
    .object({
    userIds: zod_1.z.array(zod_1.z.string().min(1)).min(1),
})
    .superRefine((value, ctx) => {
    ensureUniqueUsers(value.userIds, ctx);
});
exports.dispatchAlertSchema = zod_1.z.object({
    title: zod_1.z.string().trim().min(3).max(140).optional(),
    description: zod_1.z.string().trim().min(3).max(4000).optional(),
    autoAssignResponders: zod_1.z.boolean().default(true),
});
