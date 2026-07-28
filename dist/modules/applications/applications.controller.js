"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createApplicationController = createApplicationController;
exports.getAllApplicationsController = getAllApplicationsController;
exports.getApplicationByIdController = getApplicationByIdController;
exports.approveApplicationController = approveApplicationController;
exports.rejectApplicationController = rejectApplicationController;
const applications_service_1 = require("./applications.service");
const applications_schemas_1 = require("./applications.schemas");
async function createApplicationController(req, res) {
    try {
        const parsed = applications_schemas_1.createApplicationSchema.parse(req.body);
        const application = await (0, applications_service_1.createApplication)(parsed);
        return res.status(201).json(application);
    }
    catch (error) {
        return res.status(400).json({
            message: error.message || "Failed to create application",
        });
    }
}
async function getAllApplicationsController(req, res) {
    try {
        const status = typeof req.query.status === "string" ? req.query.status : undefined;
        const applications = await (0, applications_service_1.getAllApplications)(status);
        return res.status(200).json(applications);
    }
    catch (error) {
        return res.status(500).json({
            message: error.message || "Failed to fetch applications",
        });
    }
}
async function getApplicationByIdController(req, res) {
    try {
        const applicationId = String(req.params.id);
        const application = await (0, applications_service_1.getApplicationById)(applicationId);
        return res.status(200).json(application);
    }
    catch (error) {
        return res.status(404).json({
            message: error.message || "Application not found",
        });
    }
}
async function approveApplicationController(req, res) {
    try {
        const applicationId = String(req.params.id);
        const actorUserId = req.user?.userId;
        if (!actorUserId) {
            return res.status(401).json({ message: "Unauthorized" });
        }
        const result = await (0, applications_service_1.approveApplication)(applicationId, actorUserId);
        return res.status(200).json(result);
    }
    catch (error) {
        return res.status(400).json({
            message: error.message || "Failed to approve application",
        });
    }
}
async function rejectApplicationController(req, res) {
    try {
        const applicationId = String(req.params.id);
        const actorUserId = req.user?.userId;
        if (!actorUserId) {
            return res.status(401).json({ message: "Unauthorized" });
        }
        const parsed = applications_schemas_1.rejectApplicationSchema.parse(req.body);
        const result = await (0, applications_service_1.rejectApplication)(applicationId, actorUserId, parsed.rejectReason);
        return res.status(200).json(result);
    }
    catch (error) {
        return res.status(400).json({
            message: error.message || "Failed to reject application",
        });
    }
}
