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
    const responsibleUserId = req.user?.userId;

    if (!responsibleUserId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const parsed = createInspectionSchema.parse(req.body);

    const inspection = await createInspection({
      ...parsed,
      inspectionTime: parsed.inspectionTime || null,
      observations: parsed.observations || null,
      responsibleUserId,
      items: parsed.items.map((item) => ({
        ...item,
        observations: item.observations || null,
      })),
    });

    return res.status(201).json(inspection);
  } catch (error: any) {
    return res.status(400).json({
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