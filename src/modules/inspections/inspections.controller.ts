import { Request, Response } from "express";
import { createInspectionSchema } from "./inspections.schemas";
import {
  createInspection,
  getAllInspections,
  getInspectionById,
  getVehicleInspectionHistory,
} from "./inspections.service";

export async function createInspectionController(req: Request, res: Response) {
  try {
    const createdByUserId = req.user?.userId;

    if (!createdByUserId) {
      return res.status(401).json({ message: "Sesión no válida. Volvé a ingresar." });
    }

    const parsed = createInspectionSchema.parse(req.body);
    if (req.user!.role === "FIREFIGHTER" && !parsed.responsibleUserIds.includes(createdByUserId)) return res.status(403).json({ message: "Debe integrar el equipo que realizo el control" });

    const inspection = await createInspection({
      ...parsed,
      inspectionTime: parsed.inspectionTime,
      observations: parsed.observations || null,
      createdByUserId,
      items: parsed.items.map((item) => ({
        ...item,
        observations: item.observations || null,
      })),
    });

    return res.status(201).json(inspection);
  } catch (error: any) {
    return res.status(error.status || 400).json({
      message: error.message || "Failed to create inspection",
    });
  }
}

export async function getAllInspectionsController(req: Request, res: Response) {
  try {
    const vehicleId =
      typeof req.query.vehicleId === "string" ? req.query.vehicleId : undefined;

    const inspections = await getAllInspections(vehicleId);

    return res.status(200).json(inspections);
  } catch (error: any) {
    return res.status(500).json({
      message: error.message || "Failed to fetch inspections",
    });
  }
}

export async function getInspectionByIdController(req: Request, res: Response) {
  try {
    const inspectionId = String(req.params.id);
    const inspection = await getInspectionById(inspectionId);

    return res.status(200).json(inspection);
  } catch (error: any) {
    return res.status(404).json({
      message: error.message || "Inspection not found",
    });
  }
}

export async function getVehicleInspectionHistoryController(
  req: Request,
  res: Response,
) {
  try {
    const vehicleId = String(req.params.vehicleId);
    const history = await getVehicleInspectionHistory(vehicleId);

    return res.status(200).json(history);
  } catch (error: any) {
    return res.status(404).json({
      message: error.message || "Vehicle inspection history not found",
    });
  }
}
