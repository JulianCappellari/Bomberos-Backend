import { Request, Response, NextFunction } from "express";
import {
  createCompartmentSchema,
  createInventoryItemSchema,
  updateInventoryItemSchema,
  compartmentDeleteSchema,
} from "./equipment.schemas";
import {
  createCompartment,
  createInventoryItem,
  deleteInventoryItem,
  getVehicleInventory,
  updateInventoryItem,
} from "./equipment.service";

export async function createCompartmentController(req: Request, res: Response, next: NextFunction) {
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
    return res.status(error.status || 400).json({
      message: error.message || "No se pudo crear el compartimento",
    });
  }
}

export async function createInventoryItemController(req: Request, res: Response, next: NextFunction) {
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
    return res.status(error.status || 400).json({
      message: error.message || "No se pudo crear la herramienta",
    });
  }
}

export async function getVehicleInventoryController(req: Request, res: Response, next: NextFunction) {
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

export async function updateInventoryItemController(req: Request, res: Response, next: NextFunction) {
  try {
    const itemId = String(req.params.itemId);
    const parsed = updateInventoryItemSchema.parse(req.body);

    const result = await updateInventoryItem(itemId, parsed, req.user?.userId);

    return res.status(200).json(result);
  } catch (error: any) {
    return res.status(error.status || 400).json({
      message: error.message || "No se pudo actualizar la herramienta",
    });
  }
}

export async function deleteInventoryItemController(req: Request, res: Response, next: NextFunction) {
  try {
    const itemId = String(req.params.itemId);
    const result = await deleteInventoryItem(itemId, req.user?.userId, compartmentDeleteSchema.parse(req.body).revision);

    return res.status(200).json(result);
  } catch (error: any) {
    return res.status(error.status || 400).json({
      message: error.message || "No se pudo eliminar la herramienta",
    });
  }
}
