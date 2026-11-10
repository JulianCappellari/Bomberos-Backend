import { z } from "zod";
import { OperationError } from "../operations/operations.schemas";

export const idSchema = z.string().trim().min(1).max(100);
export const revision = z.number().int().positive();
export const workStatus = z.enum(["ASSIGNED", "SUBMITTED", "RETURNED", "VERIFIED", "CANCELLED"]);
export const pageQuery = z.object({ page: z.coerce.number().int().min(1).max(100000).default(1), q: z.string().trim().max(100).optional() });
export const workQuery = pageQuery.extend({ status: workStatus.optional(), mine: z.enum(["true", "false"]).optional(), pending: z.enum(["true", "false"]).optional() });
const uniquePeople = z.array(idSchema).min(1).max(30).refine((ids) => new Set(ids).size === ids.length, "No repita integrantes");
const https = z.string().trim().max(500).url().refine((value) => {
  const url = new URL(value);
  return url.protocol === "https:" && !url.username && !url.password;
}, "Use un enlace HTTPS sin credenciales");
export const createWorkSchema = z.object({
  title: z.string().trim().min(3).max(160), description: z.string().trim().min(5).max(4000),
  dueOn: z.string().date().nullish(), userIds: z.array(idSchema).max(30).refine((ids) => new Set(ids).size === ids.length, "No repita integrantes"),
  // K02: solo las tareas fisicas en el cuartel exigen permanencia QR abierta.
  requiresPresence: z.boolean().default(true),
});
export const transferResponseSchema = z.object({ accept: z.boolean(), notes: z.string().trim().max(1000).default("") }).strict();
// K12: estado visible derivado del estado almacenado, el equipo y el vencimiento.
export type WorkState = "OPEN" | "ASSIGNED" | "TAKEN" | "IN_REVIEW" | "VERIFIED" | "EXPIRED" | "CANCELLED" | "RETURNED";
export function workState(task: { status: string; dueOn: Date | null; activeMembers: number; claimed: boolean }, today: string): WorkState {
  if (task.status === "SUBMITTED") return "IN_REVIEW";
  if (task.status === "VERIFIED" || task.status === "CANCELLED") return task.status;
  if (task.dueOn && task.dueOn.toISOString().slice(0, 10) < today) return "EXPIRED";
  if (task.status === "RETURNED") return "RETURNED";
  return task.activeMembers === 0 ? "OPEN" : task.claimed ? "TAKEN" : "ASSIGNED";
}
export const submitWorkSchema = z.object({
  photos: z.array(z.string().min(1).max(250000).regex(/^[A-Za-z0-9+/]+={0,2}$/)).max(3).default([]),
  revision, notes: z.string().trim().min(5).max(4000), evidenceUrls: z.array(https).max(3).default([]),
  completedAt: z.string().datetime({ offset: true }),
});
export const selfWorkSchema = createWorkSchema.omit({ dueOn: true }).extend({ ...submitWorkSchema.omit({ revision: true }).shape, userIds: uniquePeople });
export const assignWorkSchema = z.object({ revision, userIds: uniquePeople, notes: z.string().trim().min(5).max(2000) });
export const planWorkSchema=z.object({revision,dueOn:z.string().date().nullable(),priority:z.enum(["LOW","NORMAL","HIGH","URGENT"]),responsibleUserId:idSchema.nullable(),notes:z.string().trim().min(10).max(2000)}).strict();
export const reviewWorkSchema = z.object({ revision, status: z.enum(["VERIFIED", "RETURNED", "CANCELLED"]), notes: z.string().trim().min(5).max(2000) });
export const memberWorkSchema = z.object({ revision, action: z.enum(["TRANSFER", "DECLINE"]), targetUserId: idSchema.optional(), notes: z.string().trim().min(5).max(2000) })
  .refine((v) => v.action === "TRANSFER" ? Boolean(v.targetUserId) : !v.targetUserId, "Indique destinatario solo al transferir");

export function assertWorkTransition(from: string, to: string) {
  const allowed: Record<string, string[]> = { ASSIGNED: ["SUBMITTED", "CANCELLED"], RETURNED: ["SUBMITTED", "CANCELLED"], SUBMITTED: ["VERIFIED", "RETURNED", "CANCELLED"] };
  if (!allowed[from]?.includes(to)) throw new OperationError(409, "La tarea ya cambio de estado o esta cerrada");
}
export function assertPast(value: string | Date, now = new Date()) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date > now) throw new OperationError(400, "La fecha no puede ser futura");
  return date;
}
export type Actor = { userId: string; role: string };
