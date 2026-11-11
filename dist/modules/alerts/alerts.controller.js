"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createAlertController = createAlertController;
exports.getAllAlertsController = getAllAlertsController;
exports.getAlertByIdController = getAlertByIdController;
exports.resolveAlertController = resolveAlertController;
exports.cancelAlertController = cancelAlertController;
exports.respondToAlertController = respondToAlertController;
exports.getAlertResponsesController = getAlertResponsesController;
const alerts_schemas_1 = require("./alerts.schemas");
const alerts_service_1 = require("./alerts.service");
const socket_1 = require("../../config/socket");
const prisma_1 = require("../../config/prisma");
// F09: cualquiera puede ver la alerta; solo quien recibio la convocatoria puede responder.
async function withViewer(alerts, userId) {
    if (!userId || !alerts.length)
        return alerts.map(alert => ({ ...alert, viewerIsRecipient: false }));
    const keys = alerts.map(alert => `alert:${alert.id}:${userId}`);
    const delivered = new Set((await prisma_1.prisma.memberNotification.findMany({ where: { dedupeKey: { in: keys } }, select: { dedupeKey: true } })).map(row => row.dedupeKey));
    return alerts.map(alert => ({ ...alert, viewerIsRecipient: delivered.has(`alert:${alert.id}:${userId}`) }));
}
async function createAlertController(req, res) {
    const userId = req.user?.userId;
    if (!userId) {
        return res.status(401).json({ message: "Sesión no válida. Volvé a ingresar." });
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
    // Emit event to all connected clients
    (0, socket_1.emitAlertEvent)("new_alert", alert);
    return res.status(201).json(alert);
}
async function getAllAlertsController(req, res) {
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const type = typeof req.query.type === "string" ? req.query.type : undefined;
    const alerts = await (0, alerts_service_1.getAllAlerts)(status, type);
    return res.status(200).json(await withViewer(alerts, req.user?.userId));
}
async function getAlertByIdController(req, res) {
    const alertId = String(req.params.id);
    const alert = await (0, alerts_service_1.getAlertById)(alertId);
    return res.status(200).json((await withViewer([alert], req.user?.userId))[0]);
}
async function resolveAlertController(req, res) {
    const alertId = String(req.params.id);
    const actorUserId = req.user?.userId;
    if (!actorUserId) {
        return res.status(401).json({ message: "Sesión no válida. Volvé a ingresar." });
    }
    const updated = await (0, alerts_service_1.resolveAlert)(alertId, actorUserId);
    (0, socket_1.emitAlertEvent)("alert_resolved", updated);
    return res.status(200).json(updated);
}
async function cancelAlertController(req, res) {
    const alertId = String(req.params.id);
    const actorUserId = req.user?.userId;
    if (!actorUserId)
        return res.status(401).json({ message: "Sesión no válida. Volvé a ingresar." });
    const parsed = alerts_schemas_1.cancelAlertSchema.parse(req.body);
    const updated = await (0, alerts_service_1.cancelAlert)(alertId, actorUserId, parsed.reason);
    (0, socket_1.emitAlertEvent)("alert_cancelled", updated);
    return res.status(200).json(updated);
}
async function respondToAlertController(req, res) {
    const alertId = String(req.params.id);
    const userId = req.user?.userId;
    if (!userId) {
        return res.status(401).json({ message: "Sesión no válida. Volvé a ingresar." });
    }
    const parsed = alerts_schemas_1.respondAlertSchema.parse(req.body);
    const response = await (0, alerts_service_1.respondToAlert)(alertId, userId, parsed.response);
    (0, socket_1.emitAlertEvent)("alert_response_updated", { alertId, response });
    return res.status(200).json(response);
}
async function getAlertResponsesController(req, res) {
    const alertId = String(req.params.id);
    const responses = await (0, alerts_service_1.getAlertResponses)(alertId);
    return res.status(200).json(responses);
}
