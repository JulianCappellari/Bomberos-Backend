"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_middleware_1 = require("../../middlewares/auth.middleware");
const role_middleware_1 = require("../../middlewares/role.middleware");
const equipment_schemas_1 = require("./equipment.schemas");
const equipment_service_1 = require("./equipment.service");
const inventory_templates_1 = require("./inventory-templates");
const prisma_1 = require("../../config/prisma");
const operations_schemas_1 = require("../operations/operations.schemas");
const equipment_controller_1 = require("./equipment.controller");
const inspections_controller_1 = require("../inspections/inspections.controller");
const router = (0, express_1.Router)();
router.get("/templates", auth_middleware_1.authenticate, (_req, res) => { res.json(inventory_templates_1.inventoryTemplates); });
router.post("/vehicles/:vehicleId/template", auth_middleware_1.authenticate, (0, role_middleware_1.authorize)("ADMIN", "OPERATOR"), async (req, res) => {
    const data = equipment_schemas_1.inventoryTemplateSchema.parse(req.body);
    res.status(201).json(await (0, equipment_service_1.applyInventoryTemplate)(String(req.params.vehicleId), data.template, req.user.userId));
});
router.put("/vehicles/:vehicleId/compartments/order", auth_middleware_1.authenticate, (0, role_middleware_1.authorize)("ADMIN", "OPERATOR"), async (req, res) => {
    res.json(await (0, equipment_service_1.reorderCompartments)(String(req.params.vehicleId), equipment_schemas_1.compartmentOrderSchema.parse(req.body), req.user.userId));
});
router.patch("/compartments/:id", auth_middleware_1.authenticate, (0, role_middleware_1.authorize)("ADMIN", "OPERATOR"), async (req, res) => {
    const data = equipment_schemas_1.compartmentChangeSchema.parse(req.body);
    res.json(await (0, equipment_service_1.renameCompartment)(String(req.params.id), data.name, data.revision, req.user.userId));
});
router.delete("/compartments/:id", auth_middleware_1.authenticate, (0, role_middleware_1.authorize)("ADMIN", "OPERATOR"), async (req, res) => {
    res.json(await (0, equipment_service_1.removeCompartment)(String(req.params.id), equipment_schemas_1.compartmentDeleteSchema.parse(req.body).revision, req.user.userId));
});
router.get("/labels/:code", auth_middleware_1.authenticate, async (req, res) => {
    const code = String(req.params.code).trim().toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9._-]{0,39}$/.test(code))
        throw new operations_schemas_1.OperationError(400, "Etiqueta invalida");
    const item = await prisma_1.prisma.vehicleInventoryItem.findFirst({ where: { labelCode: code, compartment: { vehicle: { asset: { deletedAt: null } } } }, include: { compartment: { include: { vehicle: { select: { assetId: true, unitNumber: true } } } } } });
    if (!item)
        throw new operations_schemas_1.OperationError(404, "No hay un material vigente con esa etiqueta");
    res.json(item);
});
router.post("/vehicles/:vehicleId/compartments", auth_middleware_1.authenticate, (0, role_middleware_1.authorize)("ADMIN", "OPERATOR"), equipment_controller_1.createCompartmentController);
router.post("/compartments/:compartmentId/items", auth_middleware_1.authenticate, (0, role_middleware_1.authorize)("ADMIN", "OPERATOR"), equipment_controller_1.createInventoryItemController);
router.patch("/items/:itemId", auth_middleware_1.authenticate, (0, role_middleware_1.authorize)("ADMIN", "OPERATOR"), equipment_controller_1.updateInventoryItemController);
router.delete("/items/:itemId", auth_middleware_1.authenticate, (0, role_middleware_1.authorize)("ADMIN", "OPERATOR"), equipment_controller_1.deleteInventoryItemController);
router.get("/vehicles/:vehicleId/inventory", auth_middleware_1.authenticate, equipment_controller_1.getVehicleInventoryController);
router.post("/inspections", auth_middleware_1.authenticate, inspections_controller_1.createInspectionController);
router.get("/inspections/:id", auth_middleware_1.authenticate, inspections_controller_1.getInspectionByIdController);
router.get("/vehicles/:vehicleId/inspections", auth_middleware_1.authenticate, inspections_controller_1.getVehicleInspectionHistoryController);
exports.default = router;
