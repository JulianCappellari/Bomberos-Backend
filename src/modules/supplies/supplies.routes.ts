import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../middlewares/auth.middleware";
import { rateLimit } from "../../middlewares/rate-limit.middleware";
import {
  archiveItem, cancelRequest, createItem, createItemSchema, createRequest, decideRequest, decideSchema, listItems, listMovements,
  listRequests, movementSchema, recordMovement, requestSchema, supplyOptions, supplySummary, updateItem, updateItemSchema,
} from "./supplies.service";

// Vestimenta, EPP y materiales del cuartel: stock, movimientos y pedidos.
const router = Router();
router.use(authenticate);
router.get("/summary", async (req, res) => { res.json(await supplySummary(req.user!)); });
router.get("/options", async (req, res) => { res.json(await supplyOptions(req.user!)); });
router.get("/items", async (req, res) => { res.json(await listItems(req.user!, req.query.archived === "1")); });
router.get("/movements", async (req, res) => { res.json(await listMovements(req.user!, typeof req.query.itemId === "string" ? req.query.itemId : undefined)); });
router.get("/requests", async (req, res) => { res.json(await listRequests(req.user!, z.enum(["all", "mine", "open"]).default("all").parse(req.query.scope))); });
router.use(rateLimit({ windowMs: 60000, maxRequests: 60 }));
router.post("/items", async (req, res) => { res.status(201).json(await createItem(req.user!, createItemSchema.parse(req.body))); });
router.put("/items/:id", async (req, res) => { res.json(await updateItem(req.user!, String(req.params.id), updateItemSchema.parse(req.body))); });
router.post("/items/:id/archive", async (req, res) => { res.json(await archiveItem(req.user!, String(req.params.id), z.object({ reason: z.string().trim().min(5).max(500) }).strict().parse(req.body).reason)); });
router.post("/items/:id/movements", async (req, res) => { res.status(201).json(await recordMovement(req.user!, String(req.params.id), movementSchema.parse(req.body))); });
router.post("/requests", async (req, res) => { res.status(201).json(await createRequest(req.user!, requestSchema.parse(req.body))); });
router.post("/requests/:id/decide", async (req, res) => { res.json(await decideRequest(req.user!, String(req.params.id), decideSchema.parse(req.body))); });
router.post("/requests/:id/cancel", async (req, res) => { res.json(await cancelRequest(req.user!, String(req.params.id))); });
export default router;
