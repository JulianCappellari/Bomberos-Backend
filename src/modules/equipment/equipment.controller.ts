import { Request, Response } from "express";
import {
  createCompartmentSchema,
  createInspectionSchema,
  createInventoryItemSchema,
  updateInventoryItemSchema,
} from "./equipment.schemas";
import {
  createCompartment,
  createInspection,
  createInventoryItem,
  deleteInventoryItem,
  getInspectionById,
  getVehicleInspections,
  getVehicleInventory,
  updateInventoryItem,
} from "./equipment.service";

export async function createCompartmentController(req: Request, res: Response) {
  try {
    const vehicleId = String(req.params.vehicleId);
    const parsed = createCompartmentSchema.parse(req.body);

    const result = await createCompartment(
      vehicleId,
      parsed,
      req.user?.userId,
    );

    return res.status(201).json(result);
  } catch (error: any) {
    return res.status(400).json({
      message: error.message || "No se pudo crear el compartimento",
    });
  }
}

export async function createInventoryItemController(req: Request, res: Response) {
  try {
    const compartmentId = String(req.params.compartmentId);
    const parsed = createInventoryItemSchema.parse(req.body);

    const result = await createInventoryItem(
      compartmentId,
      parsed,
      req.user?.userId,
    );

    return res.status(201).json(result);
  } catch (error: any) {
    return res.status(400).json({
      message: error.message || "No se pudo crear la herramienta",
    });
  }
}

export async function getVehicleInventoryController(req: Request, res: Response) {
  try {
    const vehicleId = String(req.params.vehicleId);
    const result = await getVehicleInventory(vehicleId);

    return res.status(200).json(result);
  } catch (error: any) {
    return res.status(404).json({
      message: error.message || "No se pudo obtener el inventario del camión",
    });
  }
}

export async function createInspectionController(req: Request, res: Response) {
  try {
    const parsed = createInspectionSchema.parse(req.body);
    const result = await createInspection({
      ...parsed,
      actorUserId: req.user?.userId,
    });

    return res.status(201).json(result);
  } catch (error: any) {
    return res.status(400).json({
      message: error.message || "No se pudo crear la inspección",
    });
  }
}

export async function getInspectionByIdController(req: Request, res: Response) {
  try {
    const inspectionId = String(req.params.id);
    const result = await getInspectionById(inspectionId);

    return res.status(200).json(result);
  } catch (error: any) {
    return res.status(404).json({
      message: error.message || "No se pudo obtener la inspección",
    });
  }
}

export async function getVehicleInspectionsController(req: Request, res: Response) {
  try {
    const vehicleId = String(req.params.vehicleId);
    const result = await getVehicleInspections(vehicleId);

    return res.status(200).json(result);
  } catch (error: any) {
    return res.status(404).json({
      message: error.message || "No se pudo obtener el historial de inspecciones",
    });
  }
}

export async function updateInventoryItemController(req: Request, res: Response) {
  try {
    const itemId = String(req.params.itemId);
    const parsed = updateInventoryItemSchema.parse(req.body);

    const result = await updateInventoryItem(itemId, parsed, req.user?.userId);

    return res.status(200).json(result);
  } catch (error: any) {
    return res.status(400).json({
      message: error.message || "No se pudo actualizar la herramienta",
    });
  }
}

export async function deleteInventoryItemController(req: Request, res: Response) {
  try {
    const itemId = String(req.params.itemId);
    const result = await deleteInventoryItem(itemId, req.user?.userId);

    return res.status(200).json(result);
  } catch (error: any) {
    return res.status(400).json({
      message: error.message || "No se pudo eliminar la herramienta",
    });
  }
}
