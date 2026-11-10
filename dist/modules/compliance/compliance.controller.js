"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listComplianceRecordsController = listComplianceRecordsController;
exports.getComplianceSummaryController = getComplianceSummaryController;
exports.createComplianceRecordController = createComplianceRecordController;
exports.updateComplianceRecordController = updateComplianceRecordController;
exports.deleteComplianceRecordController = deleteComplianceRecordController;
const compliance_schemas_1 = require("./compliance.schemas");
const compliance_service_1 = require("./compliance.service");
async function listComplianceRecordsController(req, res) {
    const filters = compliance_schemas_1.listComplianceRecordsSchema.parse(req.query);
    return res.status(200).json(await (0, compliance_service_1.listComplianceRecords)(filters));
}
async function getComplianceSummaryController(_req, res) {
    return res.status(200).json(await (0, compliance_service_1.getComplianceSummary)());
}
async function createComplianceRecordController(req, res) {
    const actorUserId = req.user?.userId;
    if (!actorUserId)
        return res.status(401).json({ message: "Unauthorized" });
    const input = compliance_schemas_1.complianceRecordInputSchema.parse(req.body);
    return res.status(201).json(await (0, compliance_service_1.createComplianceRecord)(input, actorUserId));
}
async function updateComplianceRecordController(req, res) {
    const actorUserId = req.user?.userId;
    if (!actorUserId)
        return res.status(401).json({ message: "Unauthorized" });
    const input = compliance_schemas_1.complianceRecordInputSchema.parse(req.body);
    return res
        .status(200)
        .json(await (0, compliance_service_1.updateComplianceRecord)(String(req.params.id), input, actorUserId));
}
async function deleteComplianceRecordController(req, res) {
    const actorUserId = req.user?.userId;
    if (!actorUserId)
        return res.status(401).json({ message: "Unauthorized" });
    return res
        .status(200)
        .json(await (0, compliance_service_1.deleteComplianceRecord)(String(req.params.id), actorUserId));
}
