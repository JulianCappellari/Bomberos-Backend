import { Request, Response } from "express";
import {
  createAlertSchema,
  respondAlertSchema,
} from "./alerts.schemas";
import {
  createAlert,
  getAlertById,
  getAlertResponses,
  getAllAlerts,
  resolveAlert,
  respondToAlert,
} from "./alerts.service";

export async function createAlertController(req: Request, res: Response) {
  try {
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

    return res.status(201).json(alert);
  } catch (error: any) {
    return res.status(400).json({
      message: error.message || "Failed to create alert",
    });
  }
}

export async function getAllAlertsController(req: Request, res: Response) {
  try {
    const status =
      typeof req.query.status === "string" ? req.query.status : undefined;
    const type =
      typeof req.query.type === "string" ? req.query.type : undefined;

    const alerts = await getAllAlerts(status, type);

    return res.status(200).json(alerts);
  } catch (error: any) {
    return res.status(500).json({
      message: error.message || "Failed to fetch alerts",
    });
  }
}

export async function getAlertByIdController(req: Request, res: Response) {
  try {
    const alertId = String(req.params.id);
    const alert = await getAlertById(alertId);

    return res.status(200).json(alert);
  } catch (error: any) {
    return res.status(404).json({
      message: error.message || "Alert not found",
    });
  }
}

export async function resolveAlertController(req: Request, res: Response) {
  try {
    const alertId = String(req.params.id);
    const actorUserId = req.user?.userId;

    if (!actorUserId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const updated = await resolveAlert(alertId, actorUserId);

    return res.status(200).json(updated);
  } catch (error: any) {
    return res.status(400).json({
      message: error.message || "Failed to resolve alert",
    });
  }
}

export async function respondToAlertController(req: Request, res: Response) {
  try {
    const alertId = String(req.params.id);
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const parsed = respondAlertSchema.parse(req.body);

    const response = await respondToAlert(alertId, userId, parsed.response);

    return res.status(200).json(response);
  } catch (error: any) {
    return res.status(400).json({
      message: error.message || "Failed to respond to alert",
    });
  }
}

export async function getAlertResponsesController(req: Request, res: Response) {
  try {
    const alertId = String(req.params.id);
    const responses = await getAlertResponses(alertId);

    return res.status(200).json(responses);
  } catch (error: any) {
    return res.status(404).json({
      message: error.message || "Alert responses not found",
    });
  }
}