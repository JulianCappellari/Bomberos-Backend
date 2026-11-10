"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OperationError = exports.documentTransitionSchema = exports.updateDocumentSchema = exports.createDocumentSchema = exports.documentFields = exports.documentQuerySchema = exports.maintenanceTransitionSchema = exports.maintenanceSchema = exports.maintenanceQuerySchema = exports.availabilitySchema = exports.availabilityQuerySchema = exports.revisionSchema = exports.dateSchema = void 0;
exports.isOperationsManager = isOperationsManager;
exports.isDutyManager = isDutyManager;
exports.assertMaintenanceTransition = assertMaintenanceTransition;
exports.assertDocumentTransition = assertDocumentTransition;
const zod_1 = require("zod");
exports.dateSchema = zod_1.z.string().date();
const text = (max) => zod_1.z.string().trim().max(max).nullish();
exports.revisionSchema = zod_1.z.number().int().min(1);
exports.availabilityQuerySchema = zod_1.z.object({ date: exports.dateSchema });
exports.availabilitySchema = zod_1.z.object({
    userId: zod_1.z.string().min(1).optional(),
    date: exports.dateSchema,
    period: zod_1.z.enum(["DAY", "NIGHT"]),
    status: zod_1.z.enum(["AVAILABLE", "ON_CALL", "UNAVAILABLE"]),
    notes: text(1000),
    revision: zod_1.z.number().int().min(0).default(0),
});
exports.maintenanceQuerySchema = zod_1.z.object({
    assetId: zod_1.z.string().min(1).optional(),
    status: zod_1.z.enum(["OPEN", "IN_PROGRESS", "RESOLVED", "CANCELLED"]).optional(),
});
exports.maintenanceSchema = zod_1.z.object({
    publishTask: zod_1.z.boolean().default(true),
    assetId: zod_1.z.string().min(1),
    title: zod_1.z.string().trim().min(3).max(140),
    description: zod_1.z.string().trim().min(10).max(10000),
    blocksOperation: zod_1.z.boolean().default(true),
    dueAt: exports.dateSchema.nullish(),
    responsibleUserId: text(100),
});
exports.maintenanceTransitionSchema = zod_1.z.object({
    revision: exports.revisionSchema,
    status: zod_1.z.enum(["IN_PROGRESS", "RESOLVED", "CANCELLED"]),
    resolution: text(10000),
    costCents: zod_1.z.number().int().min(0).max(2147483647).nullish(),
}).refine((value) => !["RESOLVED", "CANCELLED"].includes(value.status) || (value.resolution?.length || 0) >= 10, {
    path: ["resolution"], message: "Describa la resolucion o el motivo de cancelacion (minimo 10 caracteres)",
});
exports.documentQuerySchema = zod_1.z.object({
    kind: zod_1.z.enum(["PROTOCOL", "SHIFT_REPORT", "INCIDENT_REPORT"]).optional(),
    status: zod_1.z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]).optional(),
});
exports.documentFields = zod_1.z.object({
    kind: zod_1.z.enum(["PROTOCOL", "SHIFT_REPORT", "INCIDENT_REPORT"]),
    title: zod_1.z.string().trim().min(3).max(160),
    category: zod_1.z.string().trim().min(2).max(80),
    body: zod_1.z.string().trim().min(10).max(40000),
    externalUrl: text(500).refine((value) => {
        if (!value)
            return true;
        try {
            const url = new URL(value);
            return url.protocol === "https:" && !url.username && !url.password;
        }
        catch {
            return false;
        }
    }, "El enlace debe usar HTTPS y no contener credenciales"),
    shiftId: text(100),
    incidentId: text(100),
});
function documentSubject(value) {
    if (value.kind === "PROTOCOL")
        return !value.shiftId && !value.incidentId;
    if (value.kind === "SHIFT_REPORT")
        return Boolean(value.shiftId) && !value.incidentId;
    return Boolean(value.incidentId) && !value.shiftId;
}
exports.createDocumentSchema = exports.documentFields.refine(documentSubject, "Seleccione la guardia o intervencion correspondiente al tipo de acta");
exports.updateDocumentSchema = exports.documentFields.extend({ revision: exports.revisionSchema }).refine(documentSubject, "La referencia del acta no coincide con su tipo");
exports.documentTransitionSchema = zod_1.z.object({ revision: exports.revisionSchema, status: zod_1.z.enum(["PUBLISHED", "ARCHIVED"]) });
class OperationError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}
exports.OperationError = OperationError;
function isOperationsManager(role) {
    return role === "ADMIN" || role === "OPERATOR";
}
function isDutyManager(role) { return isOperationsManager(role) || role === "GUARD"; }
function assertMaintenanceTransition(current, next) {
    const allowed = {
        OPEN: ["IN_PROGRESS", "RESOLVED", "CANCELLED"],
        IN_PROGRESS: ["RESOLVED", "CANCELLED"],
    };
    if (!allowed[current]?.includes(next))
        throw new OperationError(409, "El trabajo ya esta cerrado o la transicion no es valida");
}
function assertDocumentTransition(current, next) {
    if (!((current === "DRAFT" && ["PUBLISHED", "ARCHIVED"].includes(next)) || (current === "PUBLISHED" && next === "ARCHIVED"))) {
        throw new OperationError(409, "El documento ya cambio de estado. Recargue la lista.");
    }
}
