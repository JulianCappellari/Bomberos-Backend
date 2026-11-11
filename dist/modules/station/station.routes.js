"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const auth_middleware_1 = require("../../middlewares/auth.middleware");
const role_middleware_1 = require("../../middlewares/role.middleware");
const operations_schemas_1 = require("../operations/operations.schemas");
const station_service_1 = require("./station.service");
const fire_risk_service_1 = require("./fire-risk.service");
const hours_stats_service_1 = require("./hours-stats.service");
const router = (0, express_1.Router)();
router.use(auth_middleware_1.authenticate);
const eventSchema = zod_1.z.object({
    title: zod_1.z.string().trim().min(3).max(160),
    description: zod_1.z.string().trim().max(4000).default(""),
    kind: zod_1.z.enum(station_service_1.EVENT_KINDS),
    location: zod_1.z.string().trim().max(200).default(""),
    startsAt: zod_1.z.string().datetime({ offset: true }),
    endsAt: zod_1.z.string().datetime({ offset: true }),
}).strict();
// Riesgo de incendio del dia (todo el personal)
router.get("/fire-risk", async (_req, res) => { res.json(await (0, fire_risk_service_1.fireRisk)()); });
// 2: tablero de comando (pantalla del cuartel)
router.get("/board", (0, role_middleware_1.authorize)("ADMIN", "OPERATOR", "GUARD"), async (_req, res) => { res.json(await (0, station_service_1.commandBoard)()); });
// 27: agenda
router.get("/events", async (req, res) => { res.json(await (0, station_service_1.listEvents)(req.user, zod_1.z.enum(["upcoming", "past"]).default("upcoming").parse(req.query.scope))); });
router.post("/events", async (req, res) => { res.status(201).json(await (0, station_service_1.saveEvent)(req.user, eventSchema.parse(req.body))); });
router.put("/events/:id", async (req, res) => { res.json(await (0, station_service_1.saveEvent)(req.user, { ...eventSchema.extend({ revision: zod_1.z.number().int().min(1) }).parse(req.body), id: String(req.params.id) })); });
router.post("/events/:id/cancel", async (req, res) => { res.json(await (0, station_service_1.cancelEvent)(req.user, String(req.params.id), zod_1.z.object({ reason: zod_1.z.string().trim().min(5).max(1000) }).strict().parse(req.body).reason)); });
router.post("/events/:id/rsvp", async (req, res) => { res.json(await (0, station_service_1.rsvpEvent)(req.user, String(req.params.id), zod_1.z.object({ response: zod_1.z.enum(["GOING", "NOT_GOING", "MAYBE"]) }).strict().parse(req.body).response)); });
// 3: refuerzos
router.post("/incidents/:id/reinforcements", async (req, res) => {
    res.status(201).json(await (0, station_service_1.requestReinforcements)(req.user, String(req.params.id), zod_1.z.object({ message: zod_1.z.string().trim().min(3).max(500), target: zod_1.z.enum(["ALL", "DRIVERS"]).default("ALL") }).strict().parse(req.body)));
});
// Estadisticas de horas (cada persona ve las suyas; administracion, las de todo el cuartel)
router.get("/reports/hours", async (req, res) => {
    const q = zod_1.z.object({ scope: zod_1.z.enum(["year", "month"]).default("year"), year: zod_1.z.coerce.number().int().min(2000).max(2100), month: zod_1.z.coerce.number().int().min(1).max(12).optional(), kind: zod_1.z.enum(["normal", "guard"]).default("normal") }).parse(req.query);
    if (q.scope === "month" && !q.month)
        throw new operations_schemas_1.OperationError(400, "Indicá el mes");
    res.json(await (0, hours_stats_service_1.hoursStatistics)(req.user, q));
});
// 18 y 35: reportes de jefatura
router.get("/reports/guards", (0, role_middleware_1.authorize)("ADMIN", "OPERATOR"), async (req, res) => { res.json(await (0, station_service_1.guardComplianceReport)(req.user, zod_1.z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).parse(req.query.month))); });
router.get("/reports/compare", (0, role_middleware_1.authorize)("ADMIN", "OPERATOR"), async (req, res) => { res.json(await (0, station_service_1.yearComparison)(zod_1.z.coerce.number().int().min(2000).max(2100).parse(req.query.year))); });
// 14: escalafon
router.get("/seniority", (0, role_middleware_1.authorize)("ADMIN", "OPERATOR"), async (req, res) => { res.json(await (0, station_service_1.seniority)(req.user)); });
router.put("/promotion-rules", (0, role_middleware_1.authorize)("ADMIN"), async (req, res) => {
    const body = zod_1.z.object({ reason: zod_1.z.string().trim().min(10).max(1000), rules: zod_1.z.array(zod_1.z.object({ rank: zod_1.z.string().trim().min(2).max(80), nextRank: zod_1.z.string().trim().min(2).max(80), minYearsInRank: zod_1.z.number().int().min(0).max(60), minYearsService: zod_1.z.number().int().min(0).max(60), minApprovedCourses: zod_1.z.number().int().min(0).max(200) }).strict()).min(1).max(20) }).strict().parse(req.body);
    res.json(await (0, station_service_1.savePromotionRules)(req.user, body.rules, body.reason));
});
// 30: biblioteca
router.get("/documents/reads/mine", async (req, res) => { res.json(await (0, station_service_1.myDocumentReads)(req.user)); });
router.post("/documents/:id/read", async (req, res) => { res.json(await (0, station_service_1.markDocumentRead)(req.user, String(req.params.id))); });
router.get("/documents/:id/reads", (0, role_middleware_1.authorize)("ADMIN", "OPERATOR"), async (req, res) => { res.json(await (0, station_service_1.documentReadReport)(req.user, String(req.params.id))); });
// 5: direcciones frecuentes para despachar
router.get("/locations", (0, role_middleware_1.authorize)("ADMIN", "OPERATOR", "GUARD"), async (_req, res) => { res.json(await (0, station_service_1.frequentLocations)()); });
exports.default = router;
