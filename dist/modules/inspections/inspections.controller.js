"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createInspectionController = createInspectionController;
exports.getAllInspectionsController = getAllInspectionsController;
exports.getInspectionByIdController = getInspectionByIdController;
exports.getVehicleInspectionHistoryController = getVehicleInspectionHistoryController;
const inspections_schemas_1 = require("./inspections.schemas");
const inspections_service_1 = require("./inspections.service");
async function createInspectionController(req, res) {
    try {
        const createdByUserId = req.user?.userId;
        if (!createdByUserId) {
            return res.status(401).json({ message: "Sesión no válida. Volvé a ingresar." });
        }
        const parsed = inspections_schemas_1.createInspectionSchema.parse(req.body);
        if (req.user.role === "FIREFIGHTER" && !parsed.responsibleUserIds.includes(createdByUserId))
            return res.status(403).json({ message: "Debe integrar el equipo que realizo el control" });
        const inspection = await (0, inspections_service_1.createInspection)({
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
    }
    catch (error) {
        return res.status(error.status || 400).json({
            message: error.message || "Failed to create inspection",
        });
    }
}
async function getAllInspectionsController(req, res) {
    try {
        const vehicleId = typeof req.query.vehicleId === "string" ? req.query.vehicleId : undefined;
        const inspections = await (0, inspections_service_1.getAllInspections)(vehicleId);
        return res.status(200).json(inspections);
    }
    catch (error) {
        return res.status(500).json({
            message: error.message || "Failed to fetch inspections",
        });
    }
}
async function getInspectionByIdController(req, res) {
    try {
        const inspectionId = String(req.params.id);
        const inspection = await (0, inspections_service_1.getInspectionById)(inspectionId);
        return res.status(200).json(inspection);
    }
    catch (error) {
        return res.status(404).json({
            message: error.message || "Inspection not found",
        });
    }
}
async function getVehicleInspectionHistoryController(req, res) {
    try {
        const vehicleId = String(req.params.vehicleId);
        const history = await (0, inspections_service_1.getVehicleInspectionHistory)(vehicleId);
        return res.status(200).json(history);
    }
    catch (error) {
        return res.status(404).json({
            message: error.message || "Vehicle inspection history not found",
        });
    }
}
