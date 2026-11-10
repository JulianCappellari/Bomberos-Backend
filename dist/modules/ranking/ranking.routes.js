"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const auth_middleware_1 = require("../../middlewares/auth.middleware");
const role_middleware_1 = require("../../middlewares/role.middleware");
const prisma_1 = require("../../config/prisma");
const transaction_1 = require("../../utils/transaction");
const station_time_1 = require("../../utils/station-time");
const operations_schemas_1 = require("../operations/operations.schemas");
const ranking_rules_1 = require("./ranking.rules");
const ranking_service_1 = require("./ranking.service");
const router = (0, express_1.Router)();
router.use(auth_middleware_1.authenticate, (0, role_middleware_1.authorize)("ADMIN"));
const month = zod_1.z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).default(() => (0, station_time_1.stationDate)().slice(0, 7));
router.get("/", async (req, res) => res.json(await (0, ranking_service_1.ranking)(month.parse(req.query.month))));
router.get("/templates", async (_req, res) => res.json(await prisma_1.prisma.rankingTemplate.findMany({ orderBy: { createdAt: "asc" } })));
router.put("/policy", async (req, res) => {
    const input = zod_1.z.object({ revision: zod_1.z.number().int().min(0), config: ranking_rules_1.policySchema, reason: zod_1.z.string().trim().min(10).max(1000) }).strict().parse(req.body);
    res.json(await (0, transaction_1.serializable)(async (tx) => {
        const old = await tx.rankingPolicy.findUnique({ where: { id: "main" } });
        if ((old?.revision || 0) !== input.revision)
            throw new operations_schemas_1.OperationError(409, "Las reglas cambiaron");
        const row = await tx.rankingPolicy.upsert({ where: { id: "main" }, create: { config: input.config }, update: { config: input.config, revision: { increment: 1 } } });
        await tx.auditLog.create({ data: { actorUserId: req.user.userId, action: "RANKING_POLICY_UPDATED", entityType: "RankingPolicy", entityId: "main", metadata: { before: old?.config || null, after: input.config, reason: input.reason, revision: row.revision } } });
        return row;
    }));
});
const template = zod_1.z.object({ title: zod_1.z.string().trim().min(3).max(160), description: zod_1.z.string().trim().min(10).max(4000), active: zod_1.z.boolean() }).strict();
router.post("/templates", async (req, res) => {
    const input = template.parse(req.body);
    res.status(201).json(await (0, transaction_1.serializable)(async (tx) => { const row = await tx.rankingTemplate.create({ data: input }); await tx.auditLog.create({ data: { actorUserId: req.user.userId, action: "RANKING_TEMPLATE_CREATED", entityType: "RankingTemplate", entityId: row.id, metadata: input } }); return row; }));
});
router.put("/templates/:id", async (req, res) => {
    const { revision, ...data } = template.extend({ revision: zod_1.z.number().int().positive() }).parse(req.body), id = String(req.params.id);
    res.json(await (0, transaction_1.serializable)(async (tx) => { const old = await tx.rankingTemplate.findUnique({ where: { id } }); if (!old || old.revision !== revision)
        throw new operations_schemas_1.OperationError(409, "La plantilla cambió"); await tx.rankingTemplate.update({ where: { id }, data: { ...data, revision: { increment: 1 } } }); await tx.auditLog.create({ data: { actorUserId: req.user.userId, action: "RANKING_TEMPLATE_UPDATED", entityType: "RankingTemplate", entityId: id, metadata: { before: old, after: data } } }); return { message: "Plantilla actualizada" }; }));
});
router.post("/recovery", async (req, res) => { const input = zod_1.z.object({ month, policyRevision: zod_1.z.number().int().min(0), scope: zod_1.z.enum(["LOW", "ALL"]).default("LOW") }).strict().parse(req.body); res.status(201).json(await (0, ranking_service_1.assignRecovery)(input.month, input.policyRevision, req.user.userId, input.scope)); });
exports.default = router;
