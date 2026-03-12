import { Request, Response } from "express";
import {
  createAssetSchema,
  createVehicleInventoryItemSchema,
  updateAssetSchema,
  updateVehicleInventoryItemSchema,
  upsertVehicleSchema,
} from "./assets.schemas";
import {
  createAsset,
  createVehicleInventoryItem,
  deleteAsset,
  deleteVehicleInventoryItem,
  getAllAssets,
  getAssetById,
  updateAsset,
  updateVehicleInventoryItem,
  upsertVehicleData,
} from "./assets.service";

export async function createAssetController(req: Request, res: Response) {
  try {
    const parsed = createAssetSchema.parse(req.body);

    const asset = await createAsset({
      ...parsed,
      notes: parsed.notes || null,
      lastCheckDate: parsed.lastCheckDate || null,
      actorUserId: req.user?.userId,
    });

    return res.status(201).json(asset);
  } catch (error: any) {
    return res.status(400).json({
      message: error.message || "Failed to create asset",
    });
  }
}

export async function getAllAssetsController(req: Request, res: Response) {
  try {
    const assetType =
      typeof req.query.assetType === "string" ? req.query.assetType : undefined;
    const status =
      typeof req.query.status === "string" ? req.query.status : undefined;

    const assets = await getAllAssets(assetType, status);

    return res.status(200).json(assets);
  } catch (error: any) {
    return res.status(500).json({
      message: error.message || "Failed to fetch assets",
    });
  }
}

export async function getAssetByIdController(req: Request, res: Response) {
  try {
    const assetId = String(req.params.id);
    const asset = await getAssetById(assetId);

    return res.status(200).json(asset);
  } catch (error: any) {
    return res.status(404).json({
      message: error.message || "Asset not found",
    });
  }
}

export async function updateAssetController(req: Request, res: Response) {
  try {
    const assetId = String(req.params.id);
    const parsed = updateAssetSchema.parse(req.body);

    const asset = await updateAsset(
      assetId,
      {
        ...parsed,
        notes: parsed.notes,
        lastCheckDate: parsed.lastCheckDate,
      },
      req.user?.userId,
    );

    return res.status(200).json(asset);
  } catch (error: any) {
    return res.status(400).json({
      message: error.message || "Failed to update asset",
    });
  }
}

export async function deleteAssetController(req: Request, res: Response) {
  try {
    const assetId = String(req.params.id);
    const result = await deleteAsset(assetId, req.user?.userId);

    return res.status(200).json(result);
  } catch (error: any) {
    return res.status(400).json({
      message: error.message || "Failed to delete asset",
    });
  }
}

export async function upsertVehicleDataController(req: Request, res: Response) {
  try {
    const assetId = String(req.params.id);
    const parsed = upsertVehicleSchema.parse(req.body);

    const vehicle = await upsertVehicleData(assetId, parsed, req.user?.userId);

    return res.status(200).json(vehicle);
  } catch (error: any) {
    return res.status(400).json({
      message: error.message || "Failed to upsert vehicle data",
    });
  }
}

export async function createVehicleInventoryItemController(req: Request, res: Response) {
  try {
    const vehicleId = String(req.params.vehicleId);
    const parsed = createVehicleInventoryItemSchema.parse(req.body);

    const item = await createVehicleInventoryItem(
      vehicleId,
      {
        ...parsed,
        compartment: parsed.compartment || null,
        notes: parsed.notes || null,
      },
      req.user?.userId,
    );

    return res.status(201).json(item);
  } catch (error: any) {
    return res.status(400).json({
      message: error.message || "Failed to create vehicle inventory item",
    });
  }
}

export async function updateVehicleInventoryItemController(req: Request, res: Response) {
  try {
    const itemId = String(req.params.itemId);
    const parsed = updateVehicleInventoryItemSchema.parse(req.body);

    const item = await updateVehicleInventoryItem(
      itemId,
      {
        ...parsed,
        compartment: parsed.compartment,
        notes: parsed.notes,
      },
      req.user?.userId,
    );

    return res.status(200).json(item);
  } catch (error: any) {
    return res.status(400).json({
      message: error.message || "Failed to update vehicle inventory item",
    });
  }
}

export async function deleteVehicleInventoryItemController(req: Request, res: Response) {
  try {
    const itemId = String(req.params.itemId);
    const result = await deleteVehicleInventoryItem(itemId, req.user?.userId);

    return res.status(200).json(result);
  } catch (error: any) {
    return res.status(400).json({
      message: error.message || "Failed to delete vehicle inventory item",
    });
  }
}