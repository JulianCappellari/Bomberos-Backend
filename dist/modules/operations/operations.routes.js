"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const operational_report_1 = require("./operational-report");
const documents_service_1 = require("./documents.service");
const zod_1 = require("zod");
const auth_middleware_1 = require("../../middlewares/auth.middleware");
const role_middleware_1 = require("../../middlewares/role.middleware");
const operations_schemas_1 = require("./operations.schemas");
const availability_service_1 = require("./availability.service");
const maintenance_service_1 = require("./maintenance.service");
const documents_service_2 = require("./documents.service");
const reports_service_1 = require("./reports.service");
const router = (0, express_1.Router)();
router.use(auth_middleware_1.authenticate);
const managers = (0, role_middleware_1.authorize)("ADMIN", "OPERATOR", "GUARD");
router.get("/reports/operational", managers, async (req, res) => { res.json(await (0, operational_report_1.operationalReport)(reports_service_1.monthlyReportQuerySchema.parse(req.query).month)); });
router.get("/reports/monthly", async (req, res) => {
    const { month } = reports_service_1.monthlyReportQuerySchema.parse(req.query);
    res.json(await (0, reports_service_1.monthlyReport)(month, req.user));
});
router.get("/reports/fuel", managers, async (req, res) => {
    res.json(await (0, reports_service_1.fuelReport)(reports_service_1.fuelReportQuerySchema.parse(req.query)));
});
router.get("/reports/hours/year", async (req, res) => {
    res.json(await (0, reports_service_1.yearHoursReport)(reports_service_1.yearReportQuerySchema.parse(req.query).year, req.user));
});
router.get("/availability", async (req, res) => {
    const { date } = operations_schemas_1.availabilityQuerySchema.parse(req.query);
    res.json(await (0, availability_service_1.listAvailability)(date, req.user));
});
router.put("/availability", async (req, res) => res.json(await (0, availability_service_1.saveAvailability)(operations_schemas_1.availabilitySchema.parse(req.body), req.user)));
router.get("/maintenance", async (req, res) => res.json(await (0, maintenance_service_1.listMaintenance)(operations_schemas_1.maintenanceQuerySchema.parse(req.query), req.user.role)));
router.post("/maintenance", managers, async (req, res) => {
    res.status(201).json(await (0, maintenance_service_1.createMaintenance)(operations_schemas_1.maintenanceSchema.parse(req.body), req.user.userId));
});
router.post("/maintenance/:id/task", managers, async (req, res) => { res.json(await (0, maintenance_service_1.publishMaintenanceTask)(String(req.params.id), req.user.userId)); });
router.patch("/maintenance/:id/status", managers, async (req, res) => {
    res.json(await (0, maintenance_service_1.transitionMaintenance)(String(req.params.id), operations_schemas_1.maintenanceTransitionSchema.parse(req.body), req.user.userId));
});
router.get("/documents", async (req, res) => res.json(await (0, documents_service_2.listDocuments)(operations_schemas_1.documentQuerySchema.parse(req.query), req.user)));
router.post("/documents", managers, async (req, res) => {
    res.status(201).json(await (0, documents_service_2.createDocument)(operations_schemas_1.createDocumentSchema.parse(req.body), req.user));
});
router.put("/documents/:id", managers, async (req, res) => {
    res.json(await (0, documents_service_2.updateDocument)(String(req.params.id), operations_schemas_1.updateDocumentSchema.parse(req.body), req.user));
});
router.post("/documents/:id/rectify", managers, async (req, res) => {
    const { revision, reason } = zod_1.z.object({ revision: zod_1.z.number().int().positive(), reason: zod_1.z.string().trim().min(10).max(2000) }).strict().parse(req.body);
    res.status(201).json(await (0, documents_service_1.rectifyDocument)(String(req.params.id), revision, reason, req.user));
});
router.patch("/documents/:id/status", managers, async (req, res) => {
    res.json(await (0, documents_service_2.transitionDocument)(String(req.params.id), operations_schemas_1.documentTransitionSchema.parse(req.body), req.user));
});
exports.default = router;
