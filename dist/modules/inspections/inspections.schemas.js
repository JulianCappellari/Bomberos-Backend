"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createInspectionSchema = exports.inspectionItemSchema = void 0;
const zod_1 = require("zod");
exports.inspectionItemSchema = zod_1.z.object({
    foundElsewhere: zod_1.z.boolean().default(false),
    foundLocation: zod_1.z.string().trim().min(3).max(200).nullable().optional(),
    inventoryItemId: zod_1.z.string().min(1),
    observedQuantity: zod_1.z.number().int().min(0),
    result: zod_1.z.enum(["OK", "MISSING", "DAMAGED"]),
    observations: zod_1.z.string().trim().max(4000).nullish(),
}).refine((v) => v.foundElsewhere ? Boolean(v.foundLocation) && v.observedQuantity > 0 : !v.foundLocation, "Indique el lugar donde encontro el material; un material ausente no puede estar en otro lugar");
exports.createInspectionSchema = zod_1.z.object({
    draftId: zod_1.z.string().min(1).optional(),
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
    inspectionTime: zod_1.z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Ingrese una hora valida"),
    observations: zod_1.z.string().trim().max(10000).nullish(),
    sectionComments: zod_1.z.array(zod_1.z.object({ compartmentId: zod_1.z.string().min(1).max(100), observations: zod_1.z.string().trim().max(2000) })).max(100).default([]),
    leaderUserId: zod_1.z.string().min(1),
    responsibleUserIds: zod_1.z.array(zod_1.z.string().min(1)).min(1),
    items: zod_1.z.array(exports.inspectionItemSchema).min(1),
}).superRefine((value, ctx) => {
    const responsibleIds = new Set(value.responsibleUserIds);
    if (responsibleIds.size !== value.responsibleUserIds.length) {
        ctx.addIssue({ code: "custom", path: ["responsibleUserIds"], message: "Hay personas repetidas" });
    }
    if (!responsibleIds.has(value.leaderUserId)) {
        ctx.addIssue({ code: "custom", path: ["leaderUserId"], message: "El encargado debe integrar el equipo de control" });
    }
    const itemIds = value.items.map((item) => item.inventoryItemId);
    if (new Set(itemIds).size !== itemIds.length) {
        ctx.addIssue({ code: "custom", path: ["items"], message: "Hay materiales repetidos en el control" });
    }
});
