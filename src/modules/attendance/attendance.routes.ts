import { Router } from "express";
import {
  createAttendanceQrChallengeController,
  getMyAttendancesController,
  getMyAttendanceSummaryController,
  getMyOpenAttendanceController,
  getPresentPersonnelController,
  scanAttendanceQrController,
} from "./attendance.controller";
import { authenticate } from "../../middlewares/auth.middleware";
import { authorize } from "../../middlewares/role.middleware";
import { prisma } from "../../config/prisma";
import { OperationError } from "../operations/operations.schemas";
import { presenceEventStream } from "./presence-events";
import { rateLimit } from "../../middlewares/rate-limit.middleware";
import { z } from "zod";
import { closeAttendance, decideCorrection, listCorrections, requestOpenAttendance } from "./close-attendance.service";


const router = Router();
router.post("/:id/close", authenticate, authorize("ADMIN", "OPERATOR", "GUARD"), async (req, res) => {
  const { reason } = z.object({ reason: z.string().trim().min(10).max(2000) }).strict().parse(req.body);
  res.json(await closeAttendance(String(req.params.id), reason, req.user!));
});
// E10: correcciones de fichajes ajenos con doble autorizacion.
router.get("/corrections", authenticate, authorize("ADMIN", "OPERATOR", "GUARD"), async (req, res) => {
  res.json(await listCorrections(z.enum(["PENDING", "ALL"]).default("PENDING").parse(req.query.status), req.user!));
});
router.post("/corrections", authenticate, authorize("ADMIN", "OPERATOR", "GUARD"), async (req, res) => {
  const input = z.object({ userId: z.string().min(1).max(100), stationId: z.string().min(1).max(100), effectiveAt: z.string().datetime({ offset: true }), reason: z.string().trim().min(10).max(2000) }).strict().parse(req.body);
  res.status(201).json(await requestOpenAttendance(input, req.user!));
});
router.post("/corrections/:id/decide", authenticate, authorize("ADMIN", "OPERATOR"), async (req, res) => {
  const input = z.object({ approve: z.boolean(), note: z.string().trim().min(5).max(1000) }).strict().parse(req.body);
  res.json(await decideCorrection(String(req.params.id), input, req.user!));
});
router.get("/present/events", authenticate, presenceEventStream);
router.get("/stations", authenticate, authorize("ADMIN", "OPERATOR", "GUARD"), async (_req, res) => { res.json(await prisma.station.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } })); });
router.post("/qr-challenges/:id/revoke", authenticate, authorize("ADMIN", "OPERATOR", "GUARD"), async (req, res) => {
  await prisma.$transaction(async (tx) => {
    const where = { id: String(req.params.id), ...(req.user!.role === "ADMIN" ? {} : { createdByUserId: req.user!.userId }) };
    const challenge = await tx.qrChallenge.findFirst({ where, select: { stationId: true, createdByUserId: true } });
    if (!challenge) throw new OperationError(404, "QR no encontrado o no es propio");
    await tx.qrChallenge.updateMany({ where: { stationId: challenge.stationId, createdByUserId: challenge.createdByUserId, revokedAt: null }, data: { revokedAt: new Date() } });
    await tx.auditLog.create({ data: { actorUserId: req.user!.userId, action: "STATION_QR_REVOKED", entityType: "QrChallenge", entityId: String(req.params.id) } });
  }); res.json({ message: "QR deshabilitado" });
});

router.post(
  "/qr-challenges",
  authenticate,
  authorize("ADMIN", "OPERATOR", "GUARD"),
  rateLimit({ windowMs: 60000, maxRequests: 20 }),
  createAttendanceQrChallengeController,
);
router.post("/scan", authenticate, scanAttendanceQrController);
router.get("/present", authenticate, getPresentPersonnelController);
router.get("/me/open", authenticate, getMyOpenAttendanceController);
router.get("/me", authenticate, getMyAttendancesController);
router.get("/me/summary", authenticate, getMyAttendanceSummaryController);

export default router;
