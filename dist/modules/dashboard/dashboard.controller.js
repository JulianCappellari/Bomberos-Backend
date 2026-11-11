"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDashboardSummaryController = getDashboardSummaryController;
exports.getOperationalReadinessController = getOperationalReadinessController;
const dashboard_service_1 = require("./dashboard.service");
const readiness_service_1 = require("./readiness.service");
async function getDashboardSummaryController(req, res) {
    try {
        const userId = req.user?.userId;
        const role = req.user?.role;
        if (!userId || !role) {
            return res.status(401).json({ message: "Sesión no válida. Volvé a ingresar." });
        }
        const summary = await (0, dashboard_service_1.getDashboardSummary)(userId, role);
        return res.status(200).json(summary);
    }
    catch (error) {
        return res.status(500).json({
            message: error.message || "No se pudo obtener el resumen operativo",
        });
    }
}
async function getOperationalReadinessController(req, res) {
    try {
        if (!req.user?.userId) {
            return res.status(401).json({ message: "Sesión no válida. Volvé a ingresar." });
        }
        const readiness = await (0, readiness_service_1.getOperationalReadiness)();
        return res.status(200).json(readiness);
    }
    catch (error) {
        return res.status(500).json({
            message: error.message || "No se pudo calcular el alistamiento operativo",
        });
    }
}
