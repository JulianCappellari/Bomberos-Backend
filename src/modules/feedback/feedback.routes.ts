import { createHmac } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../config/prisma";
import { env } from "../../config/env";
import { authenticate } from "../../middlewares/auth.middleware";
import { authorize } from "../../middlewares/role.middleware";
import { requireStepUp } from "../../middlewares/step-up.middleware";
import { stationDate } from "../../utils/station-time";
import { serializable } from "../../utils/transaction";
import { OperationError } from "../operations/operations.schemas";
import { commandUserIds, notify } from "../members/notifications.service";

// Buzon de quejas, sugerencias, ideas, opiniones y mejoras.
// - Para entrar hay que confirmar la contrasena (step-up), tambien para leer lo recibido.
// - Anonimo: no se guarda el autor en ningun lado (ni en la auditoria ni en el registro de accesos, ver request-audit);
//   solo una clave HMAC irreversible para que la persona vea sus propios envios, y solo el dia (no la hora).
// - Lo lee unicamente jefatura/administracion, que lo marca como leido; la persona ve ese estado en sus envios.
export const FEEDBACK_KINDS = ["COMPLAINT", "SUGGESTION", "IDEA", "OPINION", "IMPROVEMENT"] as const;
const KIND_LABEL: Record<(typeof FEEDBACK_KINDS)[number], string> = { COMPLAINT: "Queja", SUGGESTION: "Sugerencia", IDEA: "Idea", OPINION: "Opinión", IMPROVEMENT: "Mejora" };
const DAILY_LIMIT = 10;
const secret = () => process.env.FEEDBACK_SECRET || env.jwtAccessSecret;
export const ownerKey = (userId: string) => createHmac("sha256", secret()).update(`feedback-owner:${userId}`).digest("hex");

const createSchema = z.object({
  kind: z.enum(FEEDBACK_KINDS),
  title: z.string().trim().min(3).max(160),
  body: z.string().trim().min(5).max(4000),
  anonymous: z.boolean(),
}).strict();

const router = Router();
router.use(authenticate, requireStepUp);

router.get("/mine", async (req, res) => {
  const rows = await prisma.feedback.findMany({ where: { ownerKey: ownerKey(req.user!.userId) }, orderBy: [{ receivedOn: "desc" }, { id: "desc" }], take: 200, select: { id: true, kind: true, title: true, body: true, anonymous: true, receivedOn: true, readAt: true } });
  res.json(rows);
});

router.post("/", async (req, res) => {
  const input = createSchema.parse(req.body);
  const userId = req.user!.userId, key = ownerKey(userId), today = new Date(stationDate());
  const row = await serializable(async (tx) => {
    if (await tx.feedback.count({ where: { ownerKey: key, receivedOn: today } }) >= DAILY_LIMIT) throw new OperationError(429, "Llegaste al límite de envíos de hoy. Probá mañana.");
    const created = await tx.feedback.create({ data: {
      kind: input.kind, title: input.title, body: input.body, anonymous: input.anonymous, ownerKey: key, receivedOn: today,
      authorUserId: input.anonymous ? null : userId, sentAt: input.anonymous ? null : new Date(),
    }, select: { id: true, kind: true, title: true, body: true, anonymous: true, receivedOn: true, readAt: true } });
    // Aviso a jefatura sin datos del autor si es anonimo (tampoco se excluye a nadie, para no delatarlo).
    const who = input.anonymous ? "Anónimo" : ((await tx.user.findUnique({ where: { id: userId }, select: { username: true, profile: { select: { fullName: true } } } }))?.profile?.fullName ?? "Personal");
    const recipients = input.anonymous ? await commandUserIds(tx) : (await commandUserIds(tx)).filter((id) => id !== userId);
    await notify(tx, recipients, `Buzón: nueva ${KIND_LABEL[input.kind].toLowerCase()}`, "/feedback", `${who}: ${input.title}`);
    return created;
  });
  res.status(201).json(row);
});

router.get("/", authorize("ADMIN", "OPERATOR"), async (req, res) => {
  const { status } = z.object({ status: z.enum(["unread", "all"]).default("all") }).parse(req.query);
  const rows = await prisma.feedback.findMany({ where: status === "unread" ? { readAt: null } : {}, orderBy: [{ readAt: { sort: "asc", nulls: "first" } }, { receivedOn: "desc" }, { id: "desc" }], take: 300 });
  const people = await prisma.user.findMany({ where: { id: { in: [...new Set(rows.flatMap((r) => [r.authorUserId, r.readByUserId]).filter((x): x is string => Boolean(x)))] } }, select: { id: true, username: true, profile: { select: { fullName: true, rank: true } } } });
  const name = (id: string | null) => { const p = people.find((x) => x.id === id); return p ? p.profile?.fullName || p.username : null; };
  res.json(rows.map((r) => ({
    id: r.id, kind: r.kind, title: r.title, body: r.body, anonymous: r.anonymous, receivedOn: r.receivedOn, sentAt: r.sentAt, readAt: r.readAt,
    author: r.anonymous ? null : { name: name(r.authorUserId), rank: people.find((p) => p.id === r.authorUserId)?.profile?.rank ?? null },
    readBy: name(r.readByUserId),
  })));
});

router.post("/:id/read", authorize("ADMIN", "OPERATOR"), async (req, res) => {
  const id = z.string().min(1).max(100).parse(req.params.id);
  const row = await serializable(async (tx) => {
    const current = await tx.feedback.findUnique({ where: { id } });
    if (!current) throw new OperationError(404, "No encontrado");
    if (current.readAt) return current;
    const updated = await tx.feedback.update({ where: { id }, data: { readAt: new Date(), readByUserId: req.user!.userId } });
    // Si firmo con su nombre se le avisa; si es anonimo lo ve en "Mis envios" (no hay a quien avisar sin delatarlo).
    if (!current.anonymous && current.authorUserId) await notify(tx, [current.authorUserId], "Jefatura leyó tu envío al buzón", "/feedback", current.title);
    return updated;
  });
  res.json({ id: row.id, readAt: row.readAt });
});

export default router;
