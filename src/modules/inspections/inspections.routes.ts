import { Router } from "express";
import controlDrafts from "./control-drafts";
import { confirmInspection, removeInspectionParticipant } from "./inspection-confirmation.service";
import {
  createInspectionController,
  getAllInspectionsController,
  getInspectionByIdController,
  getVehicleInspectionHistoryController,
} from "./inspections.controller";
import { authenticate } from "../../middlewares/auth.middleware";
import { z } from "zod";
import { authorize } from "../../middlewares/role.middleware";
import { amendInspection } from "./inspection-administration.service";

const router = Router();

router.use(authenticate);
router.use("/drafts",controlDrafts);
router.post("/:id/confirm", async (req,res) => { res.json(await confirmInspection(String(req.params.id), req.user!.userId)); });
const amendment = z.object({ revision: z.number().int().positive(), reason: z.string().trim().min(10).max(2000), amendment: z.string().trim().min(10).max(4000) }).strict();
router.post("/:id/participants/:userId/remove", authorize("ADMIN", "OPERATOR"), async (req, res) => { res.json(await removeInspectionParticipant(String(req.params.id), String(req.params.userId), amendment.omit({ amendment: true }).parse(req.body), req.user!)); });
// H12: rectifican o anulan un control finalizado Administrador, Oficial y Suboficial.
router.patch("/:id", authorize("ADMIN", "OPERATOR"), async (req, res) => { res.json(await amendInspection(String(req.params.id), req.user!, amendment.parse(req.body), false)); });
router.delete("/:id", authorize("ADMIN", "OPERATOR"), async (req, res) => { res.json(await amendInspection(String(req.params.id), req.user!, amendment.omit({ amendment: true }).parse(req.body), true)); });

router.get("/", getAllInspectionsController);
router.get("/vehicle/:vehicleId/history", getVehicleInspectionHistoryController);
router.get("/:id", getInspectionByIdController);

router.post("/", authenticate, createInspectionController);

export default router;
