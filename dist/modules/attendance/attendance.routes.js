"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const attendance_controller_1 = require("./attendance.controller");
const auth_middleware_1 = require("../../middlewares/auth.middleware");
const role_middleware_1 = require("../../middlewares/role.middleware");
const prisma_1 = require("../../config/prisma");
const operations_schemas_1 = require("../operations/operations.schemas");
const presence_events_1 = require("./presence-events");
const rate_limit_middleware_1 = require("../../middlewares/rate-limit.middleware");
const zod_1 = require("zod");
const close_attendance_service_1 = require("./close-attendance.service");
const router = (0, express_1.Router)();
router.post("/:id/close", auth_middleware_1.authenticate, (0, role_middleware_1.authorize)("ADMIN", "OPERATOR", "GUARD"), async (req, res) => {
    const { reason } = zod_1.z.object({ reason: zod_1.z.string().trim().min(10).max(2000) }).strict().parse(req.body);
    res.json(await (0, close_attendance_service_1.closeAttendance)(String(req.params.id), reason, req.user));
});
// E10: correcciones de fichajes ajenos con doble autorizacion.
router.get("/corrections", auth_middleware_1.authenticate, (0, role_middleware_1.authorize)("ADMIN", "OPERATOR", "GUARD"), async (req, res) => {
    res.json(await (0, close_attendance_service_1.listCorrections)(zod_1.z.enum(["PENDING", "ALL"]).default("PENDING").parse(req.query.status), req.user));
});
router.post("/corrections", auth_middleware_1.authenticate, (0, role_middleware_1.authorize)("ADMIN", "OPERATOR", "GUARD"), async (req, res) => {
    const input = zod_1.z.object({ userId: zod_1.z.string().min(1).max(100), stationId: zod_1.z.string().min(1).max(100), effectiveAt: zod_1.z.string().datetime({ offset: true }), reason: zod_1.z.string().trim().min(10).max(2000) }).strict().parse(req.body);
    res.status(201).json(await (0, close_attendance_service_1.requestOpenAttendance)(input, req.user));
});
router.post("/corrections/:id/decide", auth_middleware_1.authenticate, (0, role_middleware_1.authorize)("ADMIN", "OPERATOR"), async (req, res) => {
    const input = zod_1.z.object({ approve: zod_1.z.boolean(), note: zod_1.z.string().trim().min(5).max(1000) }).strict().parse(req.body);
    res.json(await (0, close_attendance_service_1.decideCorrection)(String(req.params.id), input, req.user));
});
router.get("/present/events", auth_middleware_1.authenticate, presence_events_1.presenceEventStream);
router.get("/stations", auth_middleware_1.authenticate, (0, role_middleware_1.authorize)("ADMIN", "OPERATOR", "GUARD"), async (_req, res) => { res.json(await prisma_1.prisma.station.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } })); });
router.post("/qr-challenges/:id/revoke", auth_middleware_1.authenticate, (0, role_middleware_1.authorize)("ADMIN", "OPERATOR", "GUARD"), async (req, res) => {
    await prisma_1.prisma.$transaction(async (tx) => {
        const where = { id: String(req.params.id), ...(req.user.role === "ADMIN" ? {} : { createdByUserId: req.user.userId }) };
        const challenge = await tx.qrChallenge.findFirst({ where, select: { stationId: true, createdByUserId: true } });
        if (!challenge)
            throw new operations_schemas_1.OperationError(404, "QR no encontrado o no es propio");
        await tx.qrChallenge.updateMany({ where: { stationId: challenge.stationId, createdByUserId: challenge.createdByUserId, revokedAt: null }, data: { revokedAt: new Date() } });
        await tx.auditLog.create({ data: { actorUserId: req.user.userId, action: "STATION_QR_REVOKED", entityType: "QrChallenge", entityId: String(req.params.id) } });
    });
    res.json({ message: "QR deshabilitado" });
});
router.post("/qr-challenges", auth_middleware_1.authenticate, (0, role_middleware_1.authorize)("ADMIN", "OPERATOR", "GUARD"), (0, rate_limit_middleware_1.rateLimit)({ windowMs: 60000, maxRequests: 20 }), attendance_controller_1.createAttendanceQrChallengeController);
router.post("/scan", auth_middleware_1.authenticate, attendance_controller_1.scanAttendanceQrController);
router.get("/present", auth_middleware_1.authenticate, attendance_controller_1.getPresentPersonnelController);
router.get("/me/open", auth_middleware_1.authenticate, attendance_controller_1.getMyOpenAttendanceController);
router.get("/me", auth_middleware_1.authenticate, attendance_controller_1.getMyAttendancesController);
router.get("/me/summary", auth_middleware_1.authenticate, attendance_controller_1.getMyAttendanceSummaryController);
exports.default = router;
