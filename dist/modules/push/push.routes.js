"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_middleware_1 = require("../../middlewares/auth.middleware");
const rate_limit_middleware_1 = require("../../middlewares/rate-limit.middleware");
const push_schemas_1 = require("./push.schemas");
const push_service_1 = require("./push.service");
const prisma_1 = require("../../config/prisma");
const operations_schemas_1 = require("../operations/operations.schemas");
const router = (0, express_1.Router)();
router.use(auth_middleware_1.authenticate);
router.get("/", async (req, res) => { res.json(await (0, push_service_1.pushStatus)(req.user)); });
router.use((0, rate_limit_middleware_1.rateLimit)({ windowMs: 60000, maxRequests: 10, message: "Espere un minuto antes de modificar las notificaciones" }));
router.post("/subscriptions", async (req, res) => { res.status(201).json(await (0, push_service_1.subscribePush)(push_schemas_1.subscriptionSchema.parse(req.body), req.user)); });
router.delete("/subscriptions/:id", async (req, res) => { res.json(await (0, push_service_1.unsubscribePush)(String(req.params.id), req.user)); });
router.post("/test", async (req, res) => {
    const found = await prisma_1.prisma.pushSubscription.findFirst({ where: { userId: req.user.userId, sessionId: req.user.sessionId || "" } });
    if (!found)
        throw new operations_schemas_1.OperationError(409, "Active las notificaciones en este dispositivo primero");
    await prisma_1.prisma.memberNotification.create({ data: { userId: req.user.userId, title: "Prueba de notificaciones", href: "/notifications" } });
    res.status(202).json({ message: "Prueba en cola. La recepcion debe comprobarse en el dispositivo" });
});
exports.default = router;
