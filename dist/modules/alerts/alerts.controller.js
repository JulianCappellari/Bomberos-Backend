"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createAlertController = createAlertController;
exports.getAllAlertsController = getAllAlertsController;
exports.getAlertByIdController = getAlertByIdController;
exports.resolveAlertController = resolveAlertController;
exports.respondToAlertController = respondToAlertController;
exports.getAlertResponsesController = getAlertResponsesController;
const alerts_schemas_1 = require("./alerts.schemas");
const alerts_service_1 = require("./alerts.service");
async function createAlertController(req, res) {
    try {
        const userId = req.user?.userId;
        if (!userId) {
            return res.status(401).json({ message: "Unauthorized" });
        }
        const parsed = alerts_schemas_1.createAlertSchema.parse(req.body);
        const alert = await (0, alerts_service_1.createAlert)({
            type: parsed.type,
            priority: parsed.priority,
            location: parsed.location,
            description: parsed.description ?? undefined,
            contactPhone: parsed.contactPhone ?? null,
            createdByUserId: userId,
        });
        return res.status(201).json(alert);
    }
    catch (error) {
        return res.status(400).json({
            message: error.message || "Failed to create alert",
        });
    }
}
async function getAllAlertsController(req, res) {
    try {
        const status = typeof req.query.status === "string" ? req.query.status : undefined;
        const type = typeof req.query.type === "string" ? req.query.type : undefined;
        const alerts = await (0, alerts_service_1.getAllAlerts)(status, type);
        return res.status(200).json(alerts);
    }
    catch (error) {
        return res.status(500).json({
            message: error.message || "Failed to fetch alerts",
        });
    }
}
async function getAlertByIdController(req, res) {
    try {
        const alertId = String(req.params.id);
        const alert = await (0, alerts_service_1.getAlertById)(alertId);
        return res.status(200).json(alert);
    }
    catch (error) {
        return res.status(404).json({
            message: error.message || "Alert not found",
        });
    }
}
async function resolveAlertController(req, res) {
    try {
        const alertId = String(req.params.id);
        const actorUserId = req.user?.userId;
        if (!actorUserId) {
            return res.status(401).json({ message: "Unauthorized" });
        }
        const updated = await (0, alerts_service_1.resolveAlert)(alertId, actorUserId);
        return res.status(200).json(updated);
    }
    catch (error) {
        return res.status(400).json({
            message: error.message || "Failed to resolve alert",
        });
    }
}
async function respondToAlertController(req, res) {
    try {
        const alertId = String(req.params.id);
        const userId = req.user?.userId;
        if (!userId) {
            return res.status(401).json({ message: "Unauthorized" });
        }
        const parsed = alerts_schemas_1.respondAlertSchema.parse(req.body);
        const response = await (0, alerts_service_1.respondToAlert)(alertId, userId, parsed.response);
        return res.status(200).json(response);
    }
    catch (error) {
        return res.status(400).json({
            message: error.message || "Failed to respond to alert",
        });
    }
}
async function getAlertResponsesController(req, res) {
    try {
        const alertId = String(req.params.id);
        const responses = await (0, alerts_service_1.getAlertResponses)(alertId);
        return res.status(200).json(responses);
    }
    catch (error) {
        return res.status(404).json({
            message: error.message || "Alert responses not found",
        });
    }
}
