import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../config/prisma";
import { serializable } from "../../utils/transaction";
import { PUBLIC_USER_SELECT } from "../../utils/public-user";
import { isOperationsManager, OperationError } from "../operations/operations.schemas";
import { requireIncidentWrite } from "../incidents/incident-access";
import { Actor, assertPast, pageQuery, revision } from "./work.schemas";

export const notebookCategory = z.enum(["PLACE", "PERSON", "VEHICLE", "AGENCY", "NOTE", "NOVELTY", "THIRD_PARTY", "CORRECTION", "DAMAGE"]);
export const notebookQuery = pageQuery.extend({ category: notebookCategory.optional() });
export const notebookSchema = z.object({ category: notebookCategory, title: z.string().trim().min(3).max(160), body: z.string().trim().min(3).max(4000), occurredAt: z.string().datetime({ offset: true }) });
export const notebookEditSchema = notebookSchema.extend({ revision });
export const notebookDeleteSchema = z.object({ revision, notes: z.string().trim().min(5).max(2000) });
const include = { author: { select: PUBLIC_USER_SELECT } };
async function incidentAccess(tx: Prisma.TransactionClient, incidentId: string, write = false) {
  const incident = await tx.incident.findUnique({ where: { id: incidentId }, select: { status: true } });
  if (!incident) throw new OperationError(404, "Intervencion no encontrada");
  if (write && incident.status !== "OPEN") throw new OperationError(409, "La libreta de una intervencion cerrada es de solo lectura");
}
export async function listNotebook(incidentId: string, query: z.infer<typeof notebookQuery>, actor: Actor) {
  return prisma.$transaction(async (tx) => {
    await incidentAccess(tx, incidentId);
    const where: Prisma.IncidentNotebookEntryWhereInput = { incidentId, deletedAt: null, ...(query.category ? { category: query.category } : {}), ...(query.q ? { OR: [{ title: { contains: query.q, mode: "insensitive" } }, { body: { contains: query.q, mode: "insensitive" } }] } : {}) };
    return { items: await tx.incidentNotebookEntry.findMany({ where, include, orderBy: [{ occurredAt: "desc" }, { id: "desc" }], take: 30, skip: (query.page - 1) * 30 }), total: await tx.incidentNotebookEntry.count({ where }), page: query.page, pageSize: 30 };
  }, { isolationLevel: "RepeatableRead" });
}
export async function saveNotebook(incidentId: string, id: string | null, input: z.infer<typeof notebookSchema> & { revision?: number }, actor: Actor) {
  const occurredAt = assertPast(input.occurredAt);
  return serializable(async (tx) => {
    await requireIncidentWrite(tx, actor);
    let incidentStatus: "OPEN" | "CLOSED" | undefined;
    if (id) {
      await incidentAccess(tx, incidentId, true);
    } else {
      const incident = await tx.incident.findUnique({ where: { id: incidentId }, select: { status: true } });
      if (!incident) throw new OperationError(404, "Intervencion no encontrada");
      incidentStatus = incident.status;
    }
    const data = { category: input.category, title: input.title, body: input.body, occurredAt };
    let entry;
    if (id) {
      const changed = await tx.incidentNotebookEntry.updateMany({ where: { id, incidentId, ...(actor.role === "ADMIN" ? {} : { authorUserId: actor.userId }), revision: input.revision, deletedAt: null }, data: { ...data, revision: { increment: 1 } } });
      if (!changed.count) throw new OperationError(409, "La entrada cambio o no es de su autoria");
      entry = await tx.incidentNotebookEntry.findUniqueOrThrow({ where: { id }, include });
    } else entry = await tx.incidentNotebookEntry.create({ data: { ...data, incidentId, authorUserId: actor.userId }, include });
    await tx.auditLog.create({ data: { actorUserId: actor.userId, action: id ? "NOTEBOOK_UPDATED" : incidentStatus === "CLOSED" ? "INCIDENT_POST_CLOSURE_ANNEX_CREATED" : "NOTEBOOK_CREATED", entityType: "IncidentNotebookEntry", entityId: entry.id, metadata: { incidentId, revision: entry.revision, appendedAfterClosure: incidentStatus === "CLOSED" } } });
    return entry;
  });
}
export async function deleteNotebook(incidentId: string, id: string, input: z.infer<typeof notebookDeleteSchema>, actor: Actor) {
  if (!isOperationsManager(actor.role)) throw new OperationError(403, "Solo responsables pueden retirar una entrada");
  return serializable(async (tx) => {
    await requireIncidentWrite(tx, actor);
    await incidentAccess(tx, incidentId, true);
    const changed = await tx.incidentNotebookEntry.updateMany({ where: { id, incidentId, revision: input.revision, deletedAt: null }, data: { deletedAt: new Date(), revision: { increment: 1 } } });
    if (!changed.count) throw new OperationError(409, "La entrada cambio. Actualice la libreta");
    await tx.auditLog.create({ data: { actorUserId: actor.userId, action: "NOTEBOOK_RETIRED", entityType: "IncidentNotebookEntry", entityId: id, metadata: { incidentId, reason: input.notes } } });
    return { message: "Entrada retirada; historial conservado" };
  });
}
