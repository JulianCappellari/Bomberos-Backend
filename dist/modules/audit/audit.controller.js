"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listAuditLogsController = listAuditLogsController;
const audit_schemas_1 = require("./audit.schemas");
const audit_service_1 = require("./audit.service");
async function listAuditLogsController(req, res) {
    try {
        const parsed = audit_schemas_1.listAuditLogsQuerySchema.parse(req.query);
        const logs = await (0, audit_service_1.listAuditLogs)(parsed);
        return res.status(200).json(logs);
    }
    catch (error) {
        return res.status(400).json({
            message: error.message || "Failed to fetch audit logs",
        });
    }
}
