import { licensedDriverPairs } from "../incidents/driver-authorizations";
import { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma";
import { normalizeRank } from "../../utils/firefighter-ranks";
import { stationDate } from "../../utils/station-time";
import { OperationError } from "../operations/operations.schemas";

// 25: mensajes dirigidos a un grupo. Todo el personal, jefatura, choferes habilitados,
// la guardia del dia o la comision directiva.
export const CHAT_AUDIENCES = ["ALL", "COMMAND", "DRIVERS", "GUARD", "BOARD"] as const;
export type ChatAudience = (typeof CHAT_AUDIENCES)[number];
export const audienceLabels: Record<ChatAudience, string> = { ALL: "Todo el personal", COMMAND: "Jefatura", DRIVERS: "Choferes habilitados", GUARD: "Guardia de hoy", BOARD: "Comisión directiva" };

type Db = Prisma.TransactionClient | typeof prisma;
const isCommand = (rank?: string | null) => ["oficial", "suboficial", "administrador"].includes(normalizeRank(rank).replace(/\s/g, ""));

async function todayGuardIds(db: Db) {
  const today = new Date(stationDate());
  const rows = await db.shiftAssignment.findMany({ where: { shift: { date: today } }, select: { userId: true } });
  return new Set(rows.map((row) => row.userId));
}
async function driverIds(db: Db) {
  const rows = [...await db.vehicleDriverAuthorization.findMany({ where: { status: "APPROVED", validUntil: { gte: new Date(stationDate()) } }, select: { userId: true } }), ...await licensedDriverPairs(db)];
  return new Set(rows.map((row) => row.userId));
}

/** Grupos a los que pertenece una persona (siempre incluye ALL). */
export async function audiencesOf(db: Db, userId: string): Promise<ChatAudience[]> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { profile: { select: { rank: true } } } });
  const rank = user?.profile?.rank;
  const result: ChatAudience[] = ["ALL"];
  if (isCommand(rank)) result.push("COMMAND");
  if (normalizeRank(rank) === "comision directiva") result.push("BOARD");
  if ((await driverIds(db)).has(userId)) result.push("DRIVERS");
  if ((await todayGuardIds(db)).has(userId)) result.push("GUARD");
  return result;
}

/** Jefatura ve todos los grupos para poder moderar; el resto, solo los propios. */
export async function visibleAudiences(db: Db, userId: string) {
  const own = await audiencesOf(db, userId);
  return own.includes("COMMAND") ? [...CHAT_AUDIENCES] : own;
}

/** Destinatarios de un mensaje: quienes deben leerlo y confirmar. */
export async function audienceMemberIds(db: Db, audience: string) {
  const people = await db.user.findMany({ where: { isActive: true, isPendingApproval: false, deletedAt: null }, select: { id: true, profile: { select: { rank: true } } } });
  if (audience === "ALL") return people.map((p) => p.id);
  if (audience === "COMMAND") return people.filter((p) => isCommand(p.profile?.rank)).map((p) => p.id);
  if (audience === "BOARD") return people.filter((p) => normalizeRank(p.profile?.rank) === "comision directiva").map((p) => p.id);
  const set = audience === "DRIVERS" ? await driverIds(db) : await todayGuardIds(db);
  return people.filter((p) => set.has(p.id)).map((p) => p.id);
}

/** Para enviar a un grupo hay que integrarlo, salvo jefatura que puede escribir a cualquiera. */
export async function assertCanSendTo(db: Db, userId: string, audience: ChatAudience) {
  const own = await audiencesOf(db, userId);
  if (!own.includes(audience) && !own.includes("COMMAND")) throw new OperationError(403, `Solo puede escribir al grupo "${audienceLabels[audience]}" si lo integra`);
}
