import { Request, Response } from "express";
import {
  assignUsersSchema,
  closeIncidentSchema,
  createIncidentSchema,
  createIncidentUpdateSchema,
  dispatchAlertSchema,
  updateIncidentSchema,
} from "./incidents.schemas";
import {
  assignUsersToIncident,
  closeIncident,
  createIncidentUpdate,
  deleteIncidentUpdate,
  createIncident,
  dispatchIncidentFromAlert,
  getAllIncidents,
  getIncidentById,
  IncidentConflictError,
  updateIncident,
} from "./incidents.service";

export async function dispatchIncidentFromAlertController(
  req: Request,
  res: Response,
) {
  try {
    const actorUserId = req.user?.userId;
    if (!actorUserId) {
      return res.status(401).json({ message: "Sesión no válida. Volvé a ingresar." });
    }

    const parsed = dispatchAlertSchema.parse(req.body);
    const incident = await dispatchIncidentFromAlert({
      alertId: String(req.params.alertId),
      ...parsed,
      createdByUserId: actorUserId,
    });

    return res.status(201).json(incident);
  } catch (error: any) {
    return res.status(error instanceof IncidentConflictError ? 409 : 400).json({
      message: error.message || "No se pudo despachar el operativo",
    });
  }
}

export async function createIncidentController(req: Request, res: Response) {
  try {
    const actorUserId = req.user?.userId;

    if (!actorUserId) {
      return res.status(401).json({ message: "Sesión no válida. Volvé a ingresar." });
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
    return res.status(error instanceof IncidentConflictError ? 409 : 400).json({
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
      message: error.message || "Intervención no encontrada",
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
      return res.status(401).json({ message: "Sesión no válida. Volvé a ingresar." });
    }

    const parsed = closeIncidentSchema.parse(req.body);
    const updated = await closeIncident(incidentId, actorUserId, parsed, req.user?.role);

    return res.status(200).json(updated);
  } catch (error: any) {
    return res.status(error.status || 400).json({
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

export async function createIncidentUpdateController(req: Request, res: Response) {
  try {
    const actorUserId = req.user?.userId;
    if (!actorUserId) return res.status(401).json({ message: "Sesión no válida. Volvé a ingresar." });
    const parsed = createIncidentUpdateSchema.parse(req.body);
    return res.status(201).json(
      await createIncidentUpdate(String(req.params.id), actorUserId, parsed.body),
    );
  } catch (error: any) {
    return res.status(400).json({ message: error.message || "No se pudo guardar la novedad" });
  }
}

export async function deleteIncidentUpdateController(req: Request, res: Response) {
  try {
    const actorUserId = req.user?.userId;
    if (!actorUserId) return res.status(401).json({ message: "Sesión no válida. Volvé a ingresar." });
    return res.status(200).json(
      await deleteIncidentUpdate(
        String(req.params.id),
        String(req.params.updateId),
        actorUserId,
      ),
    );
  } catch (error: any) {
    return res.status(400).json({ message: error.message || "No se pudo eliminar la novedad" });
  }
}
