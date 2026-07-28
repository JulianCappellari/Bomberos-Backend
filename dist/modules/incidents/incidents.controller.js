"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createIncidentController = createIncidentController;
exports.getAllIncidentsController = getAllIncidentsController;
exports.getIncidentByIdController = getIncidentByIdController;
exports.updateIncidentController = updateIncidentController;
exports.closeIncidentController = closeIncidentController;
exports.assignUsersToIncidentController = assignUsersToIncidentController;
const incidents_schemas_1 = require("./incidents.schemas");
const incidents_service_1 = require("./incidents.service");
async function createIncidentController(req, res) {
    try {
        const actorUserId = req.user?.userId;
        if (!actorUserId) {
            return res.status(401).json({ message: "Unauthorized" });
        }
        const parsed = incidents_schemas_1.createIncidentSchema.parse(req.body);
        const incident = await (0, incidents_service_1.createIncident)({
            ...parsed,
            alertId: parsed.alertId || null,
            losses: parsed.losses || null,
            createdByUserId: actorUserId,
        });
        return res.status(201).json(incident);
    }
    catch (error) {
        return res.status(400).json({
            message: error.message || "Failed to create incident",
        });
    }
}
async function getAllIncidentsController(req, res) {
    try {
        const status = typeof req.query.status === "string" ? req.query.status : undefined;
        const incidents = await (0, incidents_service_1.getAllIncidents)(status);
        return res.status(200).json(incidents);
    }
    catch (error) {
        return res.status(500).json({
            message: error.message || "Failed to fetch incidents",
        });
    }
}
async function getIncidentByIdController(req, res) {
    try {
        const incidentId = String(req.params.id);
        const incident = await (0, incidents_service_1.getIncidentById)(incidentId);
        return res.status(200).json(incident);
    }
    catch (error) {
        return res.status(404).json({
            message: error.message || "Incident not found",
        });
    }
}
async function updateIncidentController(req, res) {
    try {
        const incidentId = String(req.params.id);
        const parsed = incidents_schemas_1.updateIncidentSchema.parse(req.body);
        const updated = await (0, incidents_service_1.updateIncident)(incidentId, parsed, req.user?.userId);
        return res.status(200).json(updated);
    }
    catch (error) {
        return res.status(400).json({
            message: error.message || "Failed to update incident",
        });
    }
}
async function closeIncidentController(req, res) {
    try {
        const incidentId = String(req.params.id);
        const actorUserId = req.user?.userId;
        if (!actorUserId) {
            return res.status(401).json({ message: "Unauthorized" });
        }
        const updated = await (0, incidents_service_1.closeIncident)(incidentId, actorUserId);
        return res.status(200).json(updated);
    }
    catch (error) {
        return res.status(400).json({
            message: error.message || "Failed to close incident",
        });
    }
}
async function assignUsersToIncidentController(req, res) {
    try {
        const incidentId = String(req.params.id);
        const parsed = incidents_schemas_1.assignUsersSchema.parse(req.body);
        const incident = await (0, incidents_service_1.assignUsersToIncident)(incidentId, parsed.userIds, req.user?.userId);
        return res.status(200).json(incident);
    }
    catch (error) {
        return res.status(400).json({
            message: error.message || "Failed to assign users to incident",
        });
    }
}
