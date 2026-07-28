"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDashboardSummaryController = getDashboardSummaryController;
const dashboard_service_1 = require("./dashboard.service");
async function getDashboardSummaryController(req, res) {
    try {
        const userId = req.user?.userId;
        const role = req.user?.role;
        if (!userId || !role) {
            return res.status(401).json({ message: "Unauthorized" });
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
