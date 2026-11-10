import { Request, Response } from "express";
import {
  cancelAlertSchema,
  createAlertSchema,
  respondAlertSchema,
} from "./alerts.schemas";
import {
  cancelAlert,
  createAlert,
  getAlertById,
  getAlertResponses,
  getAllAlerts,
  resolveAlert,
  respondToAlert,
} from "./alerts.service";
import { emitAlertEvent } from "../../config/socket";
import { prisma } from "../../config/prisma";

// F09: cualquiera puede ver la alerta; solo quien recibio la convocatoria puede responder.
async function withViewer<T extends { id: string }>(alerts: T[], userId?: string) {
  if (!userId || !alerts.length) return alerts.map(alert => ({ ...alert, viewerIsRecipient: false }));
  const keys = alerts.map(alert => `alert:${alert.id}:${userId}`);
  const delivered = new Set((await prisma.memberNotification.findMany({ where: { dedupeKey: { in: keys } }, select: { dedupeKey: true } })).map(row => row.dedupeKey));
  return alerts.map(alert => ({ ...alert, viewerIsRecipient: delivered.has(`alert:${alert.id}:${userId}`) }));
}

export async function createAlertController(req: Request, res: Response) {
  const userId = req.user?.userId;

  if (!userId) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const parsed = createAlertSchema.parse(req.body);

  const alert = await createAlert({
    type: parsed.type,
    priority: parsed.priority,
    location: parsed.location,
    description: parsed.description ?? undefined,
    contactPhone: parsed.contactPhone ?? null,
    createdByUserId: userId,
  });

  // Emit event to all connected clients
  emitAlertEvent("new_alert", alert);

  return res.status(201).json(alert);
}

export async function getAllAlertsController(req: Request, res: Response) {
  const status =
    typeof req.query.status === "string" ? req.query.status : undefined;
  const type =
    typeof req.query.type === "string" ? req.query.type : undefined;

  const alerts = await getAllAlerts(status, type);

  return res.status(200).json(await withViewer(alerts, req.user?.userId));
}

export async function getAlertByIdController(req: Request, res: Response) {
  const alertId = String(req.params.id);
  const alert = await getAlertById(alertId);
  return res.status(200).json((await withViewer([alert], req.user?.userId))[0]);
}

export async function resolveAlertController(req: Request, res: Response) {
  const alertId = String(req.params.id);
  const actorUserId = req.user?.userId;

  if (!actorUserId) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const updated = await resolveAlert(alertId, actorUserId);

  emitAlertEvent("alert_resolved", updated);

  return res.status(200).json(updated);
}

export async function cancelAlertController(req: Request, res: Response) {
  const alertId = String(req.params.id);
  const actorUserId = req.user?.userId;
  if (!actorUserId) return res.status(401).json({ message: "Unauthorized" });
  const parsed = cancelAlertSchema.parse(req.body);
  const updated = await cancelAlert(alertId, actorUserId, parsed.reason);
  emitAlertEvent("alert_cancelled", updated);
  return res.status(200).json(updated);
}

export async function respondToAlertController(req: Request, res: Response) {
  const alertId = String(req.params.id);
  const userId = req.user?.userId;

  if (!userId) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const parsed = respondAlertSchema.parse(req.body);

  const response = await respondToAlert(alertId, userId, parsed.response);

  emitAlertEvent("alert_response_updated", { alertId, response });

  return res.status(200).json(response);
}

export async function getAlertResponsesController(req: Request, res: Response) {
  const alertId = String(req.params.id);
  const responses = await getAlertResponses(alertId);

  return res.status(200).json(responses);
}
