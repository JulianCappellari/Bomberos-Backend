"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createCompartmentController = createCompartmentController;
exports.createInventoryItemController = createInventoryItemController;
exports.getVehicleInventoryController = getVehicleInventoryController;
exports.updateInventoryItemController = updateInventoryItemController;
exports.deleteInventoryItemController = deleteInventoryItemController;
const equipment_schemas_1 = require("./equipment.schemas");
const equipment_service_1 = require("./equipment.service");
async function createCompartmentController(req, res, next) {
    try {
        const vehicleId = String(req.params.vehicleId);
        const parsed = equipment_schemas_1.createCompartmentSchema.parse(req.body);
        const result = await (0, equipment_service_1.createCompartment)(vehicleId, parsed, req.user?.userId);
        return res.status(201).json(result);
    }
    catch (error) {
        return res.status(error.status || 400).json({
            message: error.message || "No se pudo crear el compartimento",
        });
    }
}
async function createInventoryItemController(req, res, next) {
    try {
        const compartmentId = String(req.params.compartmentId);
        const parsed = equipment_schemas_1.createInventoryItemSchema.parse(req.body);
        const result = await (0, equipment_service_1.createInventoryItem)(compartmentId, parsed, req.user?.userId);
        return res.status(201).json(result);
    }
    catch (error) {
        return res.status(error.status || 400).json({
            message: error.message || "No se pudo crear la herramienta",
        });
    }
}
async function getVehicleInventoryController(req, res, next) {
    try {
        const vehicleId = String(req.params.vehicleId);
        const result = await (0, equipment_service_1.getVehicleInventory)(vehicleId);
        return res.status(200).json(result);
    }
    catch (error) {
        return res.status(404).json({
            message: error.message || "No se pudo obtener el inventario del camión",
        });
    }
}
async function updateInventoryItemController(req, res, next) {
    try {
        const itemId = String(req.params.itemId);
        const parsed = equipment_schemas_1.updateInventoryItemSchema.parse(req.body);
        const result = await (0, equipment_service_1.updateInventoryItem)(itemId, parsed, req.user?.userId);
        return res.status(200).json(result);
    }
    catch (error) {
        return res.status(error.status || 400).json({
            message: error.message || "No se pudo actualizar la herramienta",
        });
    }
}
async function deleteInventoryItemController(req, res, next) {
    try {
        const itemId = String(req.params.itemId);
        const result = await (0, equipment_service_1.deleteInventoryItem)(itemId, req.user?.userId, equipment_schemas_1.compartmentDeleteSchema.parse(req.body).revision);
        return res.status(200).json(result);
    }
    catch (error) {
        return res.status(error.status || 400).json({
            message: error.message || "No se pudo eliminar la herramienta",
        });
    }
}
