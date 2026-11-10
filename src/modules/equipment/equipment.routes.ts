import { Router } from "express";
import { authenticate } from "../../middlewares/auth.middleware";
import { authorize } from "../../middlewares/role.middleware";
import { compartmentChangeSchema, compartmentDeleteSchema, compartmentOrderSchema, inventoryTemplateSchema } from "./equipment.schemas";
import { applyInventoryTemplate, renameCompartment, removeCompartment, reorderCompartments } from "./equipment.service";
import { inventoryTemplates } from "./inventory-templates";
import { prisma } from "../../config/prisma";
import { OperationError } from "../operations/operations.schemas";
import {
  createCompartmentController,
  createInventoryItemController,
  deleteInventoryItemController,
  getVehicleInventoryController,
  updateInventoryItemController,
} from "./equipment.controller";
import {
  createInspectionController,
  getInspectionByIdController,
  getVehicleInspectionHistoryController,
} from "../inspections/inspections.controller";

const router = Router();

router.get("/templates", authenticate, (_req, res) => { res.json(inventoryTemplates); });
router.post("/vehicles/:vehicleId/template", authenticate, authorize("ADMIN", "OPERATOR"), async (req, res) => {
  const data = inventoryTemplateSchema.parse(req.body);
  res.status(201).json(await applyInventoryTemplate(String(req.params.vehicleId), data.template, req.user!.userId));
});
router.put("/vehicles/:vehicleId/compartments/order", authenticate, authorize("ADMIN", "OPERATOR"), async (req, res) => {
  res.json(await reorderCompartments(String(req.params.vehicleId), compartmentOrderSchema.parse(req.body), req.user!.userId));
});
router.patch("/compartments/:id", authenticate, authorize("ADMIN", "OPERATOR"), async (req, res) => {
  const data = compartmentChangeSchema.parse(req.body);
  res.json(await renameCompartment(String(req.params.id), data.name, data.revision, req.user!.userId));
});
router.delete("/compartments/:id", authenticate, authorize("ADMIN", "OPERATOR"), async (req, res) => {
  res.json(await removeCompartment(String(req.params.id), compartmentDeleteSchema.parse(req.body).revision, req.user!.userId));
});
router.get("/labels/:code", authenticate, async (req, res) => {
  const code = String(req.params.code).trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9._-]{0,39}$/.test(code)) throw new OperationError(400, "Etiqueta invalida");
  const item = await prisma.vehicleInventoryItem.findFirst({ where: { labelCode: code, compartment: { vehicle: { asset: { deletedAt: null } } } }, include: { compartment: { include: { vehicle: { select: { assetId: true, unitNumber: true } } } } } });
  if (!item) throw new OperationError(404, "No hay un material vigente con esa etiqueta");
  res.json(item);
});

router.post(
  "/vehicles/:vehicleId/compartments",
  authenticate,
  authorize("ADMIN", "OPERATOR"),
  createCompartmentController,
);
router.post(
  "/compartments/:compartmentId/items",
  authenticate,
  authorize("ADMIN", "OPERATOR"),
  createInventoryItemController,
);
router.patch(
  "/items/:itemId",
  authenticate,
  authorize("ADMIN", "OPERATOR"),
  updateInventoryItemController,
);
router.delete(
  "/items/:itemId",
  authenticate,
  authorize("ADMIN", "OPERATOR"),
  deleteInventoryItemController,
);
router.get("/vehicles/:vehicleId/inventory", authenticate, getVehicleInventoryController);

router.post(
  "/inspections",
  authenticate,
  createInspectionController,
);
router.get("/inspections/:id", authenticate, getInspectionByIdController);
router.get("/vehicles/:vehicleId/inspections", authenticate, getVehicleInspectionHistoryController);

export default router;
