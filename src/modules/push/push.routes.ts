import { Router } from "express";
import { authenticate } from "../../middlewares/auth.middleware";
import { rateLimit } from "../../middlewares/rate-limit.middleware";
import { subscriptionSchema } from "./push.schemas";
import { pushStatus, subscribePush, unsubscribePush } from "./push.service";
import { prisma } from "../../config/prisma";
import { OperationError } from "../operations/operations.schemas";
import { normalizeRank } from "../../utils/firefighter-ranks";
const router = Router();
router.use(authenticate);
router.get("/", async (req, res) => { res.json(await pushStatus(req.user!)); });
// ¿Este usuario recibe las alertas en el celular? Explica el motivo cuando no (regla D01/D03: solo se
// convoca a quien confirmo disponibilidad y no tiene una ausencia vigente).
router.get("/alert-readiness", async (req, res) => {
  const now = new Date();
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.userId }, select: { emergencyStatusConfirmedAt: true, profile: { select: { rank: true } }, emergencyAvailability: { where: { cancelledAt: null, startsAt: { lte: now }, OR: [{ endsAt: null }, { endsAt: { gt: now } }] }, select: { endsAt: true }, take: 1 } } });
  const rank = normalizeRank(user.profile?.rank);
  if (rank === "comision directiva") return res.json({ status: "NONE", canFix: false, reason: "La Comisión Directiva no recibe las alertas operativas." });
  if (rank === "guardia" || rank === "administrador") return res.json({ status: "INFO", canFix: false, reason: "Recibís cada alerta como aviso informativo, sin tener que confirmar si vas." });
  const absence = user.emergencyAvailability[0];
  if (absence) return res.json({ status: "NONE", canFix: true, reason: `Tenés cargada una ausencia${absence.endsAt ? ` hasta el ${absence.endsAt.toLocaleString("es-AR", { hourCycle: "h23", timeZone: "America/Argentina/Buenos_Aires", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}` : " sin fecha de fin"}: mientras tanto no te convocan a las alertas.` });
  if (!user.emergencyStatusConfirmedAt) return res.json({ status: "NONE", canFix: true, reason: "Todavía no marcaste que estás disponible para emergencias, así que no te convocan a las alertas." });
  res.json({ status: "YES", canFix: false, reason: "Te convocan a las alertas: el aviso te llega a este celular." });
});
router.use(rateLimit({ windowMs: 60000, maxRequests: 10, message: "Espere un minuto antes de modificar las notificaciones" }));
router.post("/subscriptions", async (req, res) => { res.status(201).json(await subscribePush(subscriptionSchema.parse(req.body), req.user!)); });
router.delete("/subscriptions/:id", async (req, res) => { res.json(await unsubscribePush(String(req.params.id), req.user!)); });
router.post("/test", async (req, res) => {
  const found = await prisma.pushSubscription.findFirst({ where: { userId: req.user!.userId, sessionId: req.user!.sessionId || "" } });
  if (!found) throw new OperationError(409, "Active las notificaciones en este dispositivo primero");
  await prisma.memberNotification.create({ data: { userId: req.user!.userId, title: "Prueba de notificaciones", href: "/notifications" } });
  res.status(202).json({ message: "Prueba en cola. La recepcion debe comprobarse en el dispositivo" });
});
export default router;
