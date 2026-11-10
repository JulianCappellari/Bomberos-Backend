"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.memberWorkSchema = exports.reviewWorkSchema = exports.planWorkSchema = exports.assignWorkSchema = exports.selfWorkSchema = exports.submitWorkSchema = exports.transferResponseSchema = exports.createWorkSchema = exports.workQuery = exports.pageQuery = exports.workStatus = exports.revision = exports.idSchema = void 0;
exports.workState = workState;
exports.assertWorkTransition = assertWorkTransition;
exports.assertPast = assertPast;
const zod_1 = require("zod");
const operations_schemas_1 = require("../operations/operations.schemas");
exports.idSchema = zod_1.z.string().trim().min(1).max(100);
exports.revision = zod_1.z.number().int().positive();
exports.workStatus = zod_1.z.enum(["ASSIGNED", "SUBMITTED", "RETURNED", "VERIFIED", "CANCELLED"]);
exports.pageQuery = zod_1.z.object({ page: zod_1.z.coerce.number().int().min(1).max(100000).default(1), q: zod_1.z.string().trim().max(100).optional() });
exports.workQuery = exports.pageQuery.extend({ status: exports.workStatus.optional(), mine: zod_1.z.enum(["true", "false"]).optional(), pending: zod_1.z.enum(["true", "false"]).optional() });
const uniquePeople = zod_1.z.array(exports.idSchema).min(1).max(30).refine((ids) => new Set(ids).size === ids.length, "No repita integrantes");
const https = zod_1.z.string().trim().max(500).url().refine((value) => {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
}, "Use un enlace HTTPS sin credenciales");
exports.createWorkSchema = zod_1.z.object({
    title: zod_1.z.string().trim().min(3).max(160), description: zod_1.z.string().trim().min(5).max(4000),
    dueOn: zod_1.z.string().date().nullish(), userIds: zod_1.z.array(exports.idSchema).max(30).refine((ids) => new Set(ids).size === ids.length, "No repita integrantes"),
    // K02: solo las tareas fisicas en el cuartel exigen permanencia QR abierta.
    requiresPresence: zod_1.z.boolean().default(true),
});
exports.transferResponseSchema = zod_1.z.object({ accept: zod_1.z.boolean(), notes: zod_1.z.string().trim().max(1000).default("") }).strict();
function workState(task, today) {
    if (task.status === "SUBMITTED")
        return "IN_REVIEW";
    if (task.status === "VERIFIED" || task.status === "CANCELLED")
        return task.status;
    if (task.dueOn && task.dueOn.toISOString().slice(0, 10) < today)
        return "EXPIRED";
    if (task.status === "RETURNED")
        return "RETURNED";
    return task.activeMembers === 0 ? "OPEN" : task.claimed ? "TAKEN" : "ASSIGNED";
}
exports.submitWorkSchema = zod_1.z.object({
    photos: zod_1.z.array(zod_1.z.string().min(1).max(250000).regex(/^[A-Za-z0-9+/]+={0,2}$/)).max(3).default([]),
    revision: exports.revision, notes: zod_1.z.string().trim().min(5).max(4000), evidenceUrls: zod_1.z.array(https).max(3).default([]),
    completedAt: zod_1.z.string().datetime({ offset: true }),
});
exports.selfWorkSchema = exports.createWorkSchema.omit({ dueOn: true }).extend({ ...exports.submitWorkSchema.omit({ revision: true }).shape, userIds: uniquePeople });
exports.assignWorkSchema = zod_1.z.object({ revision: exports.revision, userIds: uniquePeople, notes: zod_1.z.string().trim().min(5).max(2000) });
exports.planWorkSchema = zod_1.z.object({ revision: exports.revision, dueOn: zod_1.z.string().date().nullable(), priority: zod_1.z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]), responsibleUserId: exports.idSchema.nullable(), notes: zod_1.z.string().trim().min(10).max(2000) }).strict();
exports.reviewWorkSchema = zod_1.z.object({ revision: exports.revision, status: zod_1.z.enum(["VERIFIED", "RETURNED", "CANCELLED"]), notes: zod_1.z.string().trim().min(5).max(2000) });
exports.memberWorkSchema = zod_1.z.object({ revision: exports.revision, action: zod_1.z.enum(["TRANSFER", "DECLINE"]), targetUserId: exports.idSchema.optional(), notes: zod_1.z.string().trim().min(5).max(2000) })
    .refine((v) => v.action === "TRANSFER" ? Boolean(v.targetUserId) : !v.targetUserId, "Indique destinatario solo al transferir");
function assertWorkTransition(from, to) {
    const allowed = { ASSIGNED: ["SUBMITTED", "CANCELLED"], RETURNED: ["SUBMITTED", "CANCELLED"], SUBMITTED: ["VERIFIED", "RETURNED", "CANCELLED"] };
    if (!allowed[from]?.includes(to))
        throw new operations_schemas_1.OperationError(409, "La tarea ya cambio de estado o esta cerrada");
}
function assertPast(value, now = new Date()) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime()) || date > now)
        throw new operations_schemas_1.OperationError(400, "La fecha no puede ser futura");
    return date;
}
