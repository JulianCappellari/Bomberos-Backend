"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.noticeInput = void 0;
const express_1 = require("express");
const client_1 = require("@prisma/client");
const zod_1 = require("zod");
const prisma_1 = require("../../config/prisma");
const socket_1 = require("../../config/socket");
const role_middleware_1 = require("../../middlewares/role.middleware");
const transaction_1 = require("../../utils/transaction");
const operations_schemas_1 = require("../operations/operations.schemas");
const alert_notifications_1 = require("./alert-notifications");
exports.noticeInput = zod_1.z.object({
    source: zod_1.z.string().trim().min(2).max(120),
    phone: zod_1.z.string().trim().max(40).regex(/^[+\d ()-]*$/).optional(),
    location: zod_1.z.string().trim().min(4).max(180),
    type: zod_1.z.nativeEnum(client_1.AlertType), priority: zod_1.z.nativeEnum(client_1.AlertPriority),
    notes: zod_1.z.string().trim().max(2000).default(""),
    referral: zod_1.z.string().trim().max(180).optional(),
}).strict();
const router = (0, express_1.Router)();
router.use((0, role_middleware_1.authorize)("ADMIN", "OPERATOR", "GUARD"));
router.get("/", async (req, res) => {
    const page = zod_1.z.coerce.number().int().min(1).max(10000).default(1).parse(req.query.page);
    res.json(await prisma_1.prisma.dispatchNotice.findMany({ orderBy: [{ receivedAt: "desc" }, { id: "desc" }], take: 30, skip: (page - 1) * 30,
        include: { operator: { select: { username: true } }, alert: { select: { incident: { select: { id: true } } } } } }));
});
router.post("/", async (req, res) => {
    const input = exports.noticeInput.parse(req.body), operatorId = req.user.userId;
    const notice = await (0, transaction_1.serializable)(async (tx) => {
        const notice = await tx.dispatchNotice.create({ data: { ...input, operatorId } });
        await tx.auditLog.create({ data: { actorUserId: operatorId, action: "NOTICE_RECEIVED", entityType: "DispatchNotice", entityId: notice.id } });
        return notice;
    });
    res.status(201).json(notice);
});
router.post("/:id/activate", async (req, res) => {
    const id = String(req.params.id), actor = req.user.userId;
    const result = await (0, transaction_1.serializable)(async (tx) => {
        const notice = await tx.dispatchNotice.findUnique({ where: { id } });
        if (!notice)
            throw new operations_schemas_1.OperationError(404, "Aviso no encontrado");
        if (notice.cancelledAt)
            throw new operations_schemas_1.OperationError(409, "El aviso está anulado y no se puede convocar");
        if (notice.alertId)
            return { alertId: notice.alertId, created: false };
        const alert = await tx.alert.create({ data: { type: notice.type, priority: notice.priority, location: notice.location,
                contactPhone: notice.phone || null, description: notice.notes, createdByUserId: actor } });
        await tx.dispatchNotice.update({ where: { id }, data: { alertId: alert.id, revision: { increment: 1 } } });
        await (0, alert_notifications_1.notifyAlert)(tx, alert);
        await tx.auditLog.create({ data: { actorUserId: actor, action: "NOTICE_ACTIVATED", entityType: "DispatchNotice", entityId: id, metadata: { alertId: alert.id } } });
        return { alertId: alert.id, created: true };
    });
    if (result.created)
        (0, socket_1.emitAlertEvent)("new_alert", await prisma_1.prisma.alert.findUniqueOrThrow({ where: { id: result.alertId } }));
    res.status(result.created ? 201 : 200).json(result);
});
router.put("/:id", async (req, res) => {
    const { revision, reason, ...data } = exports.noticeInput.extend({
        revision: zod_1.z.number().int().positive(), reason: zod_1.z.string().trim().min(10).max(1000),
    }).parse(req.body);
    const id = String(req.params.id), actor = req.user;
    res.json(await (0, transaction_1.serializable)(async (tx) => {
        const old = await tx.dispatchNotice.findUnique({ where: { id } });
        if (!old)
            throw new operations_schemas_1.OperationError(404, "Aviso no encontrado");
        const fields = { ...data, phone: data.phone || null, referral: data.referral || null };
        const changed = await tx.dispatchNotice.updateMany({
            where: { id, revision, alertId: null, cancelledAt: null }, data: { ...fields, revision: { increment: 1 } },
        });
        if (!changed.count)
            throw new operations_schemas_1.OperationError(409, "El aviso cambió, fue anulado o ya tiene convocatoria");
        await tx.auditLog.create({ data: {
                actorUserId: actor.userId, action: "NOTICE_CORRECTED", entityType: "DispatchNotice", entityId: id,
                metadata: { reason, before: JSON.parse(JSON.stringify(old)), after: { ...fields, revision: revision + 1 } },
            } });
        return { message: "Aviso corregido; operador y hora originales conservados" };
    }));
});
router.post("/:id/cancel", async (req, res) => {
    const { revision, reason } = zod_1.z.object({
        revision: zod_1.z.number().int().positive(), reason: zod_1.z.string().trim().min(10).max(1000),
    }).strict().parse(req.body);
    const id = String(req.params.id), actor = req.user;
    res.json(await (0, transaction_1.serializable)(async (tx) => {
        const old = await tx.dispatchNotice.findUnique({ where: { id } });
        if (!old)
            throw new operations_schemas_1.OperationError(404, "Aviso no encontrado");
        const cancelledAt = new Date();
        const changed = await tx.dispatchNotice.updateMany({
            where: { id, revision, alertId: null, cancelledAt: null },
            data: { cancelledAt, cancelReason: reason, revision: { increment: 1 } },
        });
        if (!changed.count)
            throw new operations_schemas_1.OperationError(409, "El aviso cambió, ya fue anulado o tiene convocatoria");
        await tx.auditLog.create({ data: {
                actorUserId: actor.userId, action: "NOTICE_CANCELLED", entityType: "DispatchNotice", entityId: id,
                metadata: { reason, revision, nextRevision: revision + 1, cancelledAt: cancelledAt.toISOString() },
            } });
        return { message: "Aviso anulado; historial conservado" };
    }));
});
exports.default = router;
