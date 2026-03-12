import { Request, Response } from "express";
import {
  assignUsersSchema,
  createIncidentSchema,
  updateIncidentSchema,
} from "./incidents.schemas";
import {
  assignUsersToIncident,
  closeIncident,
  createIncident,
  getAllIncidents,
  getIncidentById,
  updateIncident,
} from "./incidents.service";

export async function createIncidentController(req: Request, res: Response) {
  try {
    const actorUserId = req.user?.userId;

    if (!actorUserId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const parsed = createIncidentSchema.parse(req.body);

    const incident = await createIncident({
      ...parsed,
      alertId: parsed.alertId || null,
      losses: parsed.losses || null,
      createdByUserId: actorUserId,
    });

    return res.status(201).json(incident);
  } catch (error: any) {
    return res.status(400).json({
      message: error.message || "Failed to create incident",
    });
  }
}

export async function getAllIncidentsController(req: Request, res: Response) {
  try {
    const status =
      typeof req.query.status === "string" ? req.query.status : undefined;

    const incidents = await getAllIncidents(status);

    return res.status(200).json(incidents);
  } catch (error: any) {
    return res.status(500).json({
      message: error.message || "Failed to fetch incidents",
    });
  }
}

export async function getIncidentByIdController(req: Request, res: Response) {
  try {
    const incidentId = String(req.params.id);
    const incident = await getIncidentById(incidentId);

    return res.status(200).json(incident);
  } catch (error: any) {
    return res.status(404).json({
      message: error.message || "Incident not found",
    });
  }
}

export async function updateIncidentController(req: Request, res: Response) {
  try {
    const incidentId = String(req.params.id);
    const parsed = updateIncidentSchema.parse(req.body);

    const updated = await updateIncident(incidentId, parsed, req.user?.userId);

    return res.status(200).json(updated);
  } catch (error: any) {
    return res.status(400).json({
      message: error.message || "Failed to update incident",
    });
  }
}

export async function closeIncidentController(req: Request, res: Response) {
  try {
    const incidentId = String(req.params.id);
    const actorUserId = req.user?.userId;

    if (!actorUserId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const updated = await closeIncident(incidentId, actorUserId);

    return res.status(200).json(updated);
  } catch (error: any) {
    return res.status(400).json({
      message: error.message || "Failed to close incident",
    });
  }
}

export async function assignUsersToIncidentController(req: Request, res: Response) {
  try {
    const incidentId = String(req.params.id);
    const parsed = assignUsersSchema.parse(req.body);

    const incident = await assignUsersToIncident(
      incidentId,
      parsed.userIds,
      req.user?.userId,
    );

    return res.status(200).json(incident);
  } catch (error: any) {
    return res.status(400).json({
      message: error.message || "Failed to assign users to incident",
    });
  }
}