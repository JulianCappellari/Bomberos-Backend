import { Router } from "express";
import {
  assignUsersToShiftController,
  createShiftController,
  deleteShiftController,
  getAllShiftsController,
  getShiftByIdController,
  updateShiftController,
} from "./shifts.controller";
import { authenticate } from "../../middlewares/auth.middleware";
import { authorize } from "../../middlewares/role.middleware";
import { z } from "zod";
import { answerSwap, decideSwap, listSwaps, requestSwap, takeSwap } from "./shifts.service";

const router = Router();

router.use(authenticate);

// M02: intercambio entre bomberos con aprobacion de jefatura (bloqueado a menos de 24 h del turno).
const swapRequest = z.object({ toUserId: z.string().min(1).max(100).optional(), reason: z.string().trim().min(10).max(1000) }).strict();
router.get("/swaps", async (req, res) => { res.json(await listSwaps(req.user!)); });
router.post("/swaps/:id/take", async (req, res) => { res.json(await takeSwap(String(req.params.id), req.user!.userId)); });
router.post("/swaps/:id/answer", async (req, res) => { res.json(await answerSwap(String(req.params.id), z.object({ accept: z.boolean() }).strict().parse(req.body).accept, req.user!.userId)); });
router.post("/swaps/:id/decide", authorize("ADMIN", "OPERATOR"), async (req, res) => { res.json(await decideSwap(String(req.params.id), z.object({ approve: z.boolean(), note: z.string().trim().min(5).max(1000) }).strict().parse(req.body), req.user!)); });
router.post("/:id/swap", async (req, res) => { res.status(201).json(await requestSwap(String(req.params.id), swapRequest.parse(req.body), req.user!.userId)); });

// Todos los logueados pueden ver guardias
router.get("/", getAllShiftsController);
router.get("/:id", getShiftByIdController);

// Crear / asignar / borrar: ADMIN y OPERATOR
router.post("/", authorize("ADMIN", "OPERATOR"), createShiftController);
router.put("/:id", authorize("ADMIN", "OPERATOR"), updateShiftController);
router.post("/:id/assign-users", authorize("ADMIN", "OPERATOR"), assignUsersToShiftController);
router.delete("/:id", authorize("ADMIN", "OPERATOR"), deleteShiftController);

export default router;
