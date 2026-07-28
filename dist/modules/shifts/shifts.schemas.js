"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.assignUsersToShiftSchema = exports.listShiftsQuerySchema = exports.createShiftSchema = void 0;
const zod_1 = require("zod");
const timeSchema = zod_1.z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, {
    message: "El horario debe tener formato HH:mm",
});
function timeToMinutes(value) {
    const [hours, minutes] = value.split(":").map(Number);
    return hours * 60 + minutes;
}
exports.createShiftSchema = zod_1.z
    .object({
    date: zod_1.z.string().date(),
    startTime: timeSchema,
    endTime: timeSchema,
    shiftType: zod_1.z.string().trim().min(2).max(60),
    notes: zod_1.z.string().trim().optional().or(zod_1.z.literal("")),
    assignedUserIds: zod_1.z.array(zod_1.z.string().min(1)).optional(),
})
    .superRefine((value, ctx) => {
    if (timeToMinutes(value.endTime) <= timeToMinutes(value.startTime)) {
        ctx.addIssue({
            code: "custom",
            path: ["endTime"],
            message: "La hora de fin debe ser posterior a la hora de inicio",
        });
    }
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
exports.listShiftsQuerySchema = zod_1.z.object({
    date: zod_1.z.string().date().optional(),
    from: zod_1.z.string().date().optional(),
    to: zod_1.z.string().date().optional(),
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
