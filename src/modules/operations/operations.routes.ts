import { Router } from "express";
import {operationalReport} from "./operational-report";
import { rectifyDocument } from "./documents.service";
import { z } from "zod";
import { authenticate } from "../../middlewares/auth.middleware";
import { authorize } from "../../middlewares/role.middleware";
import {
  availabilityQuerySchema, availabilitySchema, maintenanceSchema, maintenanceQuerySchema,
  maintenanceTransitionSchema, createDocumentSchema, updateDocumentSchema, documentQuerySchema, documentTransitionSchema,
} from "./operations.schemas";
import { listAvailability, saveAvailability } from "./availability.service";
import { listMaintenance, createMaintenance, transitionMaintenance, publishMaintenanceTask } from "./maintenance.service";
import { listDocuments, createDocument, updateDocument, transitionDocument } from "./documents.service";
import { fuelReport, fuelReportQuerySchema, monthlyReport, monthlyReportQuerySchema, yearHoursReport, yearReportQuerySchema } from "./reports.service";

const router = Router();
router.use(authenticate);
const managers = authorize("ADMIN", "OPERATOR", "GUARD");
router.get("/reports/operational",managers,async(req,res)=>{res.json(await operationalReport(monthlyReportQuerySchema.parse(req.query).month));});
router.get("/reports/monthly", async (req, res) => {
  const { month } = monthlyReportQuerySchema.parse(req.query);
  res.json(await monthlyReport(month, req.user!));
});
router.get("/reports/fuel", managers, async (req, res) => {
  res.json(await fuelReport(fuelReportQuerySchema.parse(req.query)));
});
router.get("/reports/hours/year", async (req, res) => {
  res.json(await yearHoursReport(yearReportQuerySchema.parse(req.query).year, req.user!));
});
router.get("/availability", async (req, res) => {
  const { date } = availabilityQuerySchema.parse(req.query);
  res.json(await listAvailability(date, req.user!));
});
router.put("/availability", async (req, res) => res.json(await saveAvailability(availabilitySchema.parse(req.body), req.user!)));
router.get("/maintenance", async (req, res) => res.json(await listMaintenance(maintenanceQuerySchema.parse(req.query), req.user!.role)));
router.post("/maintenance", managers, async (req, res) => {
  res.status(201).json(await createMaintenance(maintenanceSchema.parse(req.body), req.user!.userId));
});
router.post("/maintenance/:id/task", managers, async (req, res) => { res.json(await publishMaintenanceTask(String(req.params.id), req.user!.userId)); });
router.patch("/maintenance/:id/status", managers, async (req, res) => {
  res.json(await transitionMaintenance(String(req.params.id), maintenanceTransitionSchema.parse(req.body), req.user!.userId));
});
router.get("/documents", async (req, res) => res.json(await listDocuments(documentQuerySchema.parse(req.query), req.user!)));
router.post("/documents", managers, async (req, res) => {
  res.status(201).json(await createDocument(createDocumentSchema.parse(req.body), req.user!));
});
router.put("/documents/:id", managers, async (req, res) => {
  res.json(await updateDocument(String(req.params.id), updateDocumentSchema.parse(req.body), req.user!));
});
router.post("/documents/:id/rectify", managers, async (req,res) => {
  const { revision, reason } = z.object({ revision: z.number().int().positive(), reason: z.string().trim().min(10).max(2000) }).strict().parse(req.body);
  res.status(201).json(await rectifyDocument(String(req.params.id), revision, reason, req.user!));
});
router.patch("/documents/:id/status", managers, async (req, res) => {
  res.json(await transitionDocument(String(req.params.id), documentTransitionSchema.parse(req.body), req.user!));
});
export default router;
