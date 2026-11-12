import { Prisma } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../config/prisma";
import { authorize } from "../../middlewares/role.middleware";
import { requireStepUp } from "../../middlewares/step-up.middleware";
import { stationDate } from "../../utils/station-time";
import { serializable } from "../../utils/transaction";
import { OperationError } from "../operations/operations.schemas";
import { notify } from "../members/notifications.service";

// Sanciones disciplinarias. Quedan en el legajo de la persona, descuentan puntos del ranking (en el mes en que
// empiezan) y pueden restringir funciones del sistema mientras estan vigentes:
//  SUSPENDED   suspension del servicio: no registra asistencia con QR, no es convocado a alertas ni integra dotaciones o tareas.
//  NO_DRIVING  no puede ser conductor.
//  NO_GUARD    no puede ser asignado a guardias.
export const SANCTION_KINDS = ["WARNING", "REPRIMAND", "SUSPENSION", "OTHER"] as const;
export const RESTRICTIONS = ["SUSPENDED", "NO_DRIVING", "NO_GUARD"] as const;
export type Restriction = (typeof RESTRICTIONS)[number];
const KIND_LABEL: Record<string, string> = { WARNING: "Apercibimiento", REPRIMAND: "Amonestación", SUSPENSION: "Suspensión", OTHER: "Sanción" };
const RESTRICTION_LABEL: Record<Restriction, string> = { SUSPENDED: "suspendido del servicio", NO_DRIVING: "no puede conducir", NO_GUARD: "no puede hacer guardias" };
type Db = Prisma.TransactionClient | typeof prisma;

/** Filtro de Prisma: sancion vigente hoy que incluye la restriccion. */
export function activeSanctionWhere(restriction: Restriction, today = new Date(stationDate())): Prisma.SanctionWhereInput {
  return { revokedAt: null, startsOn: { lte: today }, OR: [{ endsOn: null }, { endsOn: { gte: today } }], restrictions: { has: restriction } };
}
export async function restrictedUserIds(db: Db, restriction: Restriction, userIds: string[]) {
  if (!userIds.length) return new Set<string>();
  const rows = await db.sanction.findMany({ where: { ...activeSanctionWhere(restriction), userId: { in: userIds } }, select: { userId: true } });
  return new Set(rows.map((r) => r.userId));
}
/** Corta la operacion si alguna persona tiene vigente la restriccion (o una suspension, que las incluye a todas). */
export async function assertNotRestricted(db: Db, userIds: string[], restriction: Restriction, action: string) {
  const ids = [...new Set(userIds)];
  const blocked = new Set([...await restrictedUserIds(db, "SUSPENDED", ids), ...(restriction === "SUSPENDED" ? [] : await restrictedUserIds(db, restriction, ids))]);
  if (!blocked.size) return;
  const people = await db.user.findMany({ where: { id: { in: [...blocked] } }, select: { username: true, profile: { select: { fullName: true } } } });
  throw new OperationError(409, `${people.map((p) => p.profile?.fullName || p.username).join(", ")} tiene una sanción vigente: ${action}`);
}

const createSchema = z.object({
  userId: z.string().min(1).max(100),
  kind: z.enum(SANCTION_KINDS),
  reason: z.string().trim().min(10).max(2000),
  startsOn: z.string().date(),
  endsOn: z.string().date().nullable().optional(),
  points: z.number().int().min(0).max(1000).default(0),
  restrictions: z.array(z.enum(RESTRICTIONS)).max(3).default([]),
}).strict().refine((v) => !v.endsOn || v.endsOn >= v.startsOn, { message: "La fecha de fin no puede ser anterior al inicio", path: ["endsOn"] })
  .refine((v) => v.kind !== "SUSPENSION" || v.restrictions.includes("SUSPENDED"), { message: "Una suspensión debe restringir el servicio", path: ["restrictions"] })
  .refine((v) => !v.restrictions.length || Boolean(v.endsOn), { message: "Las restricciones necesitan una fecha de fin", path: ["endsOn"] });

const command = (role?: string) => role === "ADMIN" || role === "OPERATOR";
const describe = (s: { kind: string; restrictions: string[]; startsOn: Date; endsOn: Date | null; points: number }) =>
  [KIND_LABEL[s.kind] ?? s.kind, s.restrictions.length ? (s.restrictions as Restriction[]).map((r) => RESTRICTION_LABEL[r]).join(", ") : null, s.endsOn ? `hasta el ${s.endsOn.toISOString().slice(0, 10)}` : null, s.points ? `-${s.points} puntos` : null].filter(Boolean).join(" · ");

export const sanctionsRouter = Router();
// Legajo: la persona ve las suyas; jefatura, las de cualquiera.
sanctionsRouter.get("/", async (req, res) => {
  const { userId } = z.object({ userId: z.string().min(1).max(100).optional() }).parse(req.query);
  const target = userId || req.user!.userId;
  if (target !== req.user!.userId && !command(req.user!.role)) throw new OperationError(403, "Solo jefatura consulta sanciones ajenas");
  const today = new Date(stationDate());
  const rows = await prisma.sanction.findMany({ where: { userId: target }, orderBy: [{ startsOn: "desc" }, { createdAt: "desc" }], include: { issuedBy: { select: { username: true, profile: { select: { fullName: true } } } } } });
  res.json(rows.map(({ issuedBy, ...s }) => ({ ...s, issuedBy: issuedBy.profile?.fullName || issuedBy.username, active: !s.revokedAt && s.startsOn <= today && (!s.endsOn || s.endsOn >= today) })));
});
sanctionsRouter.post("/", authorize("ADMIN", "OPERATOR"), requireStepUp, async (req, res) => {
  const input = createSchema.parse(req.body);
  if (input.userId === req.user!.userId) throw new OperationError(403, "Otra persona de jefatura debe registrar una sanción propia");
  const row = await serializable(async (tx) => {
    const person = await tx.user.findFirst({ where: { id: input.userId, deletedAt: null }, select: { id: true } });
    if (!person) throw new OperationError(404, "Persona no encontrada");
    const created = await tx.sanction.create({ data: { userId: input.userId, kind: input.kind, reason: input.reason, startsOn: new Date(input.startsOn), endsOn: input.endsOn ? new Date(input.endsOn) : null, points: input.points, restrictions: input.restrictions, issuedByUserId: req.user!.userId } });
    await tx.auditLog.create({ data: { actorUserId: req.user!.userId, action: "SANCTION_ISSUED", entityType: "Sanction", entityId: created.id, metadata: { ...input } } });
    await notify(tx, [input.userId], `Se registró una sanción en tu legajo: ${KIND_LABEL[input.kind]}`, "/me?tab=record", `${describe(created)}. Motivo: ${input.reason}`.slice(0, 2000));
    return created;
  });
  res.status(201).json(row);
});
sanctionsRouter.post("/:id/revoke", authorize("ADMIN", "OPERATOR"), requireStepUp, async (req, res) => {
  const input = z.object({ reason: z.string().trim().min(10).max(1000), revision: z.number().int().positive() }).strict().parse(req.body);
  const id = z.string().min(1).max(100).parse(req.params.id);
  const row = await serializable(async (tx) => {
    const current = await tx.sanction.findUnique({ where: { id } });
    if (!current || current.revision !== input.revision || current.revokedAt) throw new OperationError(409, "La sanción cambió o ya fue dejada sin efecto");
    if (current.userId === req.user!.userId) throw new OperationError(403, "Otra persona de jefatura debe decidirlo");
    const updated = await tx.sanction.update({ where: { id }, data: { revokedAt: new Date(), revokedByUserId: req.user!.userId, revokeReason: input.reason, revision: { increment: 1 } } });
    await tx.auditLog.create({ data: { actorUserId: req.user!.userId, action: "SANCTION_REVOKED", entityType: "Sanction", entityId: id, metadata: { userId: current.userId, reason: input.reason } } });
    await notify(tx, [current.userId], "Una sanción de tu legajo quedó sin efecto", "/me?tab=record", input.reason);
    return updated;
  });
  res.json(row);
});

/** Puntos a descontar en el ranking del mes: sanciones vigentes (no revocadas) que empiezan en ese mes. */
export async function sanctionPoints(db: Db, month: string) {
  const start = new Date(`${month}-01T00:00:00Z`), end = new Date(start); end.setUTCMonth(end.getUTCMonth() + 1);
  const rows = await db.sanction.groupBy({ by: ["userId"], where: { revokedAt: null, startsOn: { gte: start, lt: end } }, _sum: { points: true } });
  return new Map(rows.map((r) => [r.userId, r._sum.points ?? 0]));
}
