import { Request, Response } from "express";
import {
  createAssetSchema,
  updateAssetSchema,
  upsertVehicleDataSchema,
} from "./assets.schemas";
import {
  createAsset,
  deleteAsset,
  getAllAssets,
  getAssetById,
  updateAsset,
  upsertVehicleData,
} from "./assets.service";

export async function createAssetController(req: Request, res: Response) {
  try {
    const parsed = createAssetSchema.parse(req.body);

    const result = await createAsset({
      ...parsed,
      actorUserId: req.user?.userId,
    });

    return res.status(201).json(result);
  } catch (error: any) {
    return res.status(400).json({
      message: error.message || "No se pudo crear el asset",
    });
  }
}

export async function getAllAssetsController(req: Request, res: Response) {
  try {
    const assetType =
      typeof req.query.assetType === "string" ? req.query.assetType : undefined;
    const status =
      typeof req.query.status === "string" ? req.query.status : undefined;

    const result = await getAllAssets(assetType, status);

    return res.status(200).json(result);
  } catch (error: any) {
    return res.status(400).json({
      message: error.message || "No se pudieron obtener los assets",
    });
  }
}

export async function getAssetByIdController(req: Request, res: Response) {
  try {
    const assetId = String(req.params.id);
    const result = await getAssetById(assetId);

    return res.status(200).json(result);
  } catch (error: any) {
    return res.status(404).json({
      message: error.message || "No se pudo obtener el asset",
    });
  }
}

export async function updateAssetController(req: Request, res: Response) {
  try {
    const assetId = String(req.params.id);
    const parsed = updateAssetSchema.parse(req.body);

    const result = await updateAsset(assetId, parsed, req.user?.userId);

    return res.status(200).json(result);
  } catch (error: any) {
    return res.status(400).json({
      message: error.message || "No se pudo actualizar el asset",
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
      message: error.message || "No se pudo eliminar el asset",
    });
  }
}

export async function upsertVehicleDataController(req: Request, res: Response) {
  try {
    const assetId = String(req.params.id);
    const parsed = upsertVehicleDataSchema.parse(req.body);

    const result = await upsertVehicleData(assetId, parsed, req.user?.userId);

    return res.status(200).json(result);
  } catch (error: any) {
    return res.status(400).json({
      message: error.message || "No se pudieron guardar los datos del vehículo",
    });
  }
}