import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../middlewares/auth.middleware";
import { authorize } from "../../middlewares/role.middleware";
import { OperationError } from "../operations/operations.schemas";
import {
  cancelEvent, commandBoard, documentReadReport, EVENT_KINDS, frequentLocations, guardComplianceReport, listEvents, markDocumentRead,
  myDocumentReads, requestReinforcements, rsvpEvent, saveEvent, savePromotionRules, seniority, yearComparison,
} from "./station.service";
import { fireRisk } from "./fire-risk.service";
import { hoursStatistics } from "./hours-stats.service";

const router = Router();
router.use(authenticate);

const eventSchema = z.object({
  title: z.string().trim().min(3).max(160),
  description: z.string().trim().max(4000).default(""),
  kind: z.enum(EVENT_KINDS),
  location: z.string().trim().max(200).default(""),
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }),
}).strict();

// Riesgo de incendio del dia (todo el personal)
router.get("/fire-risk", async (_req, res) => { res.json(await fireRisk()); });

// 2: tablero de comando (pantalla del cuartel)
router.get("/board", authorize("ADMIN", "OPERATOR", "GUARD"), async (_req, res) => { res.json(await commandBoard()); });

// 27: agenda
router.get("/events", async (req, res) => { res.json(await listEvents(req.user!, z.enum(["upcoming", "past"]).default("upcoming").parse(req.query.scope))); });
router.post("/events", async (req, res) => { res.status(201).json(await saveEvent(req.user!, eventSchema.parse(req.body))); });
router.put("/events/:id", async (req, res) => { res.json(await saveEvent(req.user!, { ...eventSchema.extend({ revision: z.number().int().min(1) }).parse(req.body), id: String(req.params.id) })); });
router.post("/events/:id/cancel", async (req, res) => { res.json(await cancelEvent(req.user!, String(req.params.id), z.object({ reason: z.string().trim().min(5).max(1000) }).strict().parse(req.body).reason)); });
router.post("/events/:id/rsvp", async (req, res) => { res.json(await rsvpEvent(req.user!, String(req.params.id), z.object({ response: z.enum(["GOING", "NOT_GOING", "MAYBE"]) }).strict().parse(req.body).response)); });

// 3: refuerzos
router.post("/incidents/:id/reinforcements", async (req, res) => {
  res.status(201).json(await requestReinforcements(req.user!, String(req.params.id), z.object({ message: z.string().trim().min(3).max(500), target: z.enum(["ALL", "DRIVERS"]).default("ALL") }).strict().parse(req.body)));
});

// Estadisticas de horas (cada persona ve las suyas; administracion, las de todo el cuartel)
router.get("/reports/hours", async (req, res) => {
  const q = z.object({ scope: z.enum(["year", "month"]).default("year"), year: z.coerce.number().int().min(2000).max(2100), month: z.coerce.number().int().min(1).max(12).optional(), kind: z.enum(["normal", "guard"]).default("normal") }).parse(req.query);
  if (q.scope === "month" && !q.month) throw new OperationError(400, "Indicá el mes");
  res.json(await hoursStatistics(req.user!, q));
});

// 18 y 35: reportes de jefatura
router.get("/reports/guards", authorize("ADMIN", "OPERATOR"), async (req, res) => { res.json(await guardComplianceReport(req.user!, z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).parse(req.query.month))); });
router.get("/reports/compare", authorize("ADMIN", "OPERATOR"), async (req, res) => { res.json(await yearComparison(z.coerce.number().int().min(2000).max(2100).parse(req.query.year))); });

// 14: escalafon
router.get("/seniority", authorize("ADMIN", "OPERATOR"), async (req, res) => { res.json(await seniority(req.user!)); });
router.put("/promotion-rules", authorize("ADMIN"), async (req, res) => {
  const body = z.object({ reason: z.string().trim().min(10).max(1000), rules: z.array(z.object({ rank: z.string().trim().min(2).max(80), nextRank: z.string().trim().min(2).max(80), minYearsInRank: z.number().int().min(0).max(60), minYearsService: z.number().int().min(0).max(60), minApprovedCourses: z.number().int().min(0).max(200) }).strict()).min(1).max(20) }).strict().parse(req.body);
  res.json(await savePromotionRules(req.user!, body.rules, body.reason));
});

// 30: biblioteca
router.get("/documents/reads/mine", async (req, res) => { res.json(await myDocumentReads(req.user!)); });
router.post("/documents/:id/read", async (req, res) => { res.json(await markDocumentRead(req.user!, String(req.params.id))); });
router.get("/documents/:id/reads", authorize("ADMIN", "OPERATOR"), async (req, res) => { res.json(await documentReadReport(req.user!, String(req.params.id))); });

// 5: direcciones frecuentes para despachar
router.get("/locations", authorize("ADMIN", "OPERATOR", "GUARD"), async (_req, res) => { res.json(await frequentLocations()); });

export default router;
