import { Router } from "express";
import { AlertPriority, AlertType } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../config/prisma";
import { emitAlertEvent } from "../../config/socket";
import { authorize } from "../../middlewares/role.middleware";
import { serializable } from "../../utils/transaction";
import { OperationError } from "../operations/operations.schemas";
import { notifyAlert } from "./alert-notifications";

export const noticeInput = z.object({
  source: z.string().trim().min(2).max(120),
  phone: z.string().trim().max(40).regex(/^[+\d ()-]*$/).optional(),
  location: z.string().trim().min(4).max(180),
  type: z.nativeEnum(AlertType), priority: z.nativeEnum(AlertPriority),
  notes: z.string().trim().max(2000).default(""),
  referral: z.string().trim().max(180).optional(),
}).strict();
const router = Router();
router.use(authorize("ADMIN", "OPERATOR", "GUARD"));
router.get("/", async (req, res) => {
  const page = z.coerce.number().int().min(1).max(10000).default(1).parse(req.query.page);
  res.json(await prisma.dispatchNotice.findMany({ orderBy: [{ receivedAt: "desc" }, { id: "desc" }], take: 30, skip: (page - 1) * 30,
    include: { operator: { select: { username: true } }, alert: { select: { incident: { select: { id: true } } } } } }));
});
router.post("/", async (req, res) => {
  const input = noticeInput.parse(req.body), operatorId = req.user!.userId;
  const notice = await serializable(async tx => {
    const notice = await tx.dispatchNotice.create({ data: { ...input, operatorId } });
    await tx.auditLog.create({ data: { actorUserId: operatorId, action: "NOTICE_RECEIVED", entityType: "DispatchNotice", entityId: notice.id } });
    return notice;
  });
  res.status(201).json(notice);
});
router.post("/:id/activate", async (req, res) => {
  const id = String(req.params.id), actor = req.user!.userId;
  const result = await serializable(async tx => {
    const notice = await tx.dispatchNotice.findUnique({ where: { id } });
    if (!notice) throw new OperationError(404, "Aviso no encontrado");
    if(notice.cancelledAt)throw new OperationError(409,"El aviso está anulado y no se puede convocar");
    if (notice.alertId) return { alertId: notice.alertId, created: false };
    const alert = await tx.alert.create({ data: { type: notice.type, priority: notice.priority, location: notice.location,
      contactPhone: notice.phone || null, description: notice.notes, createdByUserId: actor } });
    await tx.dispatchNotice.update({ where: { id }, data: { alertId: alert.id,revision:{increment:1} } });
    await notifyAlert(tx, alert);
    await tx.auditLog.create({ data: { actorUserId: actor, action: "NOTICE_ACTIVATED", entityType: "DispatchNotice", entityId: id, metadata: { alertId: alert.id } } });
    return { alertId: alert.id, created: true };
  });
  if (result.created) emitAlertEvent("new_alert", await prisma.alert.findUniqueOrThrow({ where: { id: result.alertId } }));
  res.status(result.created ? 201 : 200).json(result);
});
router.put("/:id", async (req, res) => {
  const { revision, reason, ...data } = noticeInput.extend({
    revision: z.number().int().positive(), reason: z.string().trim().min(10).max(1000),
  }).parse(req.body);
  const id = String(req.params.id), actor = req.user!;
  res.json(await serializable(async tx => {
    const old = await tx.dispatchNotice.findUnique({ where: { id } });
    if (!old) throw new OperationError(404, "Aviso no encontrado");
    const fields = { ...data, phone: data.phone || null, referral: data.referral || null };
    const changed = await tx.dispatchNotice.updateMany({
      where: { id, revision, alertId: null, cancelledAt: null }, data: { ...fields, revision: { increment: 1 } },
    });
    if (!changed.count) throw new OperationError(409, "El aviso cambió, fue anulado o ya tiene convocatoria");
    await tx.auditLog.create({ data: {
      actorUserId: actor.userId, action: "NOTICE_CORRECTED", entityType: "DispatchNotice", entityId: id,
      metadata: { reason, before: JSON.parse(JSON.stringify(old)), after: { ...fields, revision: revision + 1 } },
    } });
    return { message: "Aviso corregido; operador y hora originales conservados" };
  }));
});
router.post("/:id/cancel", async (req, res) => {
  const { revision, reason } = z.object({
    revision: z.number().int().positive(), reason: z.string().trim().min(10).max(1000),
  }).strict().parse(req.body);
  const id = String(req.params.id), actor = req.user!;
  res.json(await serializable(async tx => {
    const old = await tx.dispatchNotice.findUnique({ where: { id } });
    if (!old) throw new OperationError(404, "Aviso no encontrado");
    const cancelledAt = new Date();
    const changed = await tx.dispatchNotice.updateMany({
      where: { id, revision, alertId: null, cancelledAt: null },
      data: { cancelledAt, cancelReason: reason, revision: { increment: 1 } },
    });
    if (!changed.count) throw new OperationError(409, "El aviso cambió, ya fue anulado o tiene convocatoria");
    await tx.auditLog.create({ data: {
      actorUserId: actor.userId, action: "NOTICE_CANCELLED", entityType: "DispatchNotice", entityId: id,
      metadata: { reason, revision, nextRevision: revision + 1, cancelledAt: cancelledAt.toISOString() },
    } });
    return { message: "Aviso anulado; historial conservado" };
  }));
});
export default router;
