"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createAssetController = createAssetController;
exports.getAllAssetsController = getAllAssetsController;
exports.getAssetByIdController = getAssetByIdController;
exports.updateAssetController = updateAssetController;
exports.deleteAssetController = deleteAssetController;
exports.upsertVehicleDataController = upsertVehicleDataController;
const assets_schemas_1 = require("./assets.schemas");
const assets_service_1 = require("./assets.service");
async function createAssetController(req, res) {
    try {
        const parsed = assets_schemas_1.createAssetSchema.parse(req.body);
        const result = await (0, assets_service_1.createAsset)({
            ...parsed,
            actorUserId: req.user?.userId,
        });
        return res.status(201).json(result);
    }
    catch (error) {
        return res.status(400).json({
            message: error.message || "No se pudo crear el asset",
        });
    }
}
async function getAllAssetsController(req, res) {
    try {
        const assetType = typeof req.query.assetType === "string" ? req.query.assetType : undefined;
        const status = typeof req.query.status === "string" ? req.query.status : undefined;
        const result = await (0, assets_service_1.getAllAssets)(assetType, status);
        return res.status(200).json(result);
    }
    catch (error) {
        return res.status(400).json({
            message: error.message || "No se pudieron obtener los assets",
        });
    }
}
async function getAssetByIdController(req, res) {
    try {
        const assetId = String(req.params.id);
        const result = await (0, assets_service_1.getAssetById)(assetId);
        return res.status(200).json(result);
    }
    catch (error) {
        return res.status(404).json({
            message: error.message || "No se pudo obtener el asset",
        });
    }
}
async function updateAssetController(req, res) {
    try {
        const assetId = String(req.params.id);
        const parsed = assets_schemas_1.updateAssetSchema.parse(req.body);
        const result = await (0, assets_service_1.updateAsset)(assetId, parsed, req.user?.userId);
        return res.status(200).json(result);
    }
    catch (error) {
        return res.status(400).json({
            message: error.message || "No se pudo actualizar el asset",
        });
    }
}
async function deleteAssetController(req, res) {
    try {
        const assetId = String(req.params.id);
        const result = await (0, assets_service_1.deleteAsset)(assetId, req.user?.userId);
        return res.status(200).json(result);
    }
    catch (error) {
        return res.status(400).json({
            message: error.message || "No se pudo eliminar el asset",
        });
    }
}
async function upsertVehicleDataController(req, res) {
    try {
        const assetId = String(req.params.id);
        const parsed = assets_schemas_1.upsertVehicleDataSchema.parse(req.body);
        const result = await (0, assets_service_1.upsertVehicleData)(assetId, parsed, req.user?.userId);
        return res.status(200).json(result);
    }
    catch (error) {
        return res.status(400).json({
            message: error.message || "No se pudieron guardar los datos del vehículo",
        });
    }
}
