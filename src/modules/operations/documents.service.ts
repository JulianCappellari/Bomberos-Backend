import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../config/prisma";
import { serializable } from "../../utils/transaction";
import { PUBLIC_USER_SELECT } from "../../utils/public-user";
import { Actor } from "../work/work.schemas";

function assertWriter(kind: string, actor: Actor, ownerId?: string) {
  if (kind === "SHIFT_REPORT") {
    if (!isOperationsManager(actor.role) && (actor.role !== "GUARD" || ownerId && ownerId !== actor.userId)) throw new OperationError(403, "Solo jefatura o el guardia autor pueden completar el acta");
  } else if (!isOperationsManager(actor.role)) throw new OperationError(403, "No puede administrar este documento");
}
import { createDocumentSchema, updateDocumentSchema, documentTransitionSchema, documentQuerySchema, assertDocumentTransition, isOperationsManager, OperationError } from "./operations.schemas";

const include = {
  createdBy: { select: PUBLIC_USER_SELECT },
  shift: { select: { id: true, date: true, period: true, shiftType: true } },
  incident: { select: { id: true, title: true, status: true } },
} as const;
async function validateSubject(tx: Prisma.TransactionClient, input: z.infer<typeof createDocumentSchema>) {
  if (input.shiftId && !(await tx.shift.findUnique({ where: { id: input.shiftId }, select: { id: true } }))) {
    throw new OperationError(400, "La guardia vinculada no existe");
  }
  if (input.incidentId && !(await tx.incident.findUnique({ where: { id: input.incidentId }, select: { id: true } }))) {
    throw new OperationError(400, "La intervencion vinculada no existe");
  }
}
function documentData(input: z.infer<typeof createDocumentSchema>) {
  return {
    kind: input.kind, title: input.title, category: input.category, body: input.body,
    externalUrl: input.externalUrl || null, shiftId: input.shiftId || null, incidentId: input.incidentId || null,
  };
}
export async function listDocuments(filters: z.infer<typeof documentQuerySchema>, actor: Actor) {
  const role = actor.role;
  if (!isOperationsManager(role) && role !== "GUARD" && filters.status && filters.status !== "PUBLISHED") {
    throw new OperationError(403, "Solo los responsables pueden consultar borradores y documentos archivados");
  }
  return prisma.operationalDocument.findMany({
    where: { AND: [filters, isOperationsManager(role) ? {} : role === "GUARD" ? { OR: [{ kind: "SHIFT_REPORT", createdByUserId: actor.userId }, { kind: { not: "SHIFT_REPORT" }, status: "PUBLISHED" }] } : { kind: { not: "SHIFT_REPORT" }, status: "PUBLISHED" }] },
    include, orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
  });
}
export async function createDocument(input: z.infer<typeof createDocumentSchema>, actor: Actor) {
  assertWriter(input.kind, actor); const actorUserId = actor.userId;
  return serializable(async (tx) => {
    await validateSubject(tx, input);
    const document = await tx.operationalDocument.create({
      data: { ...documentData(input), createdByUserId: actorUserId }, include,
    });
    await tx.auditLog.create({
      data: { actorUserId, action: "DOCUMENT_CREATED", entityType: "OperationalDocument", entityId: document.id, metadata: { kind: document.kind } },
    });
    return document;
  });
}
export async function updateDocument(id: string, input: z.infer<typeof updateDocumentSchema>, actor: Actor) {
  assertWriter(input.kind, actor); const actorUserId = actor.userId;
  return serializable(async (tx) => {
    const existing = await tx.operationalDocument.findUnique({ where: { id } });
    if (!existing) throw new OperationError(404, "Documento no encontrado");
    assertWriter(existing.kind, actor, existing.createdByUserId);
    if (existing.sourceDocumentId && (existing.kind !== input.kind || existing.shiftId !== (input.shiftId || null) || existing.incidentId !== (input.incidentId || null))) throw new OperationError(400, "Una rectificacion debe conservar el tipo y servicio del documento original");
    await validateSubject(tx, input);
    // M06: un acta de guardia publicada admite edicion directa solo durante las 24 horas siguientes;
    // despues corresponde una rectificacion. La version anterior queda en auditoria (N07).
    const directEdit = existing.status === "PUBLISHED" && existing.kind === "SHIFT_REPORT" && Boolean(existing.publishedAt) && Date.now() - existing.publishedAt!.getTime() < 24 * 3600000;
    if (existing.status === "PUBLISHED" && !directEdit) throw new OperationError(409, existing.kind === "SHIFT_REPORT" ? "Pasaron más de 24 horas desde la publicación: use una rectificación" : "El documento publicado solo se corrige mediante una rectificación");
    if (directEdit && (existing.kind !== input.kind || existing.shiftId !== (input.shiftId || null))) throw new OperationError(400, "La edición de un acta publicada debe conservar su tipo y su guardia");
    const changed = await tx.operationalDocument.updateMany({
      where: { id, status: directEdit ? "PUBLISHED" : "DRAFT", revision: input.revision },
      data: { ...documentData(input), revision: { increment: 1 } },
    });
    if (!changed.count) throw new OperationError(409, "El documento fue publicado o modificado. Recargue la lista.");
    await tx.auditLog.create({
      data: { actorUserId, action: directEdit ? "DOCUMENT_PUBLISHED_EDITED" : "DOCUMENT_UPDATED", entityType: "OperationalDocument", entityId: id, metadata: { revision: input.revision + 1, ...(directEdit ? { before: { title: existing.title, category: existing.category, body: existing.body, externalUrl: existing.externalUrl } } : {}) } },
    });
    return tx.operationalDocument.findUniqueOrThrow({ where: { id }, include });
  });
}
export async function transitionDocument(id: string, input: z.infer<typeof documentTransitionSchema>, actor: Actor) {
  const actorUserId = actor.userId;
  return serializable(async (tx) => {
    const document = await tx.operationalDocument.findUnique({ where: { id } });
    if (!document) throw new OperationError(404, "Documento no encontrado");
    assertWriter(document.kind, actor, document.createdByUserId);
    assertDocumentTransition(document.status, input.status);
    let context: Prisma.InputJsonValue | undefined;
    if (input.status === "PUBLISHED") {
      if (document.sourceDocumentId) {
        const original = await tx.operationalDocument.findUnique({ where: { id: document.sourceDocumentId } });
        if (!original || original.status !== "PUBLISHED") throw new OperationError(409, "La version original cambio; revise la rectificacion antes de publicar");
        await tx.operationalDocument.update({ where: { id: original.id }, data: { status: "ARCHIVED", revision: { increment: 1 } } });
        await tx.auditLog.create({ data: { actorUserId, action: "DOCUMENT_REPLACED_BY_RECTIFICATION", entityType: "OperationalDocument", entityId: original.id, metadata: { replacementId: id } } });
      }
      const shift = document.shiftId ? await tx.shift.findUnique({
        where: { id: document.shiftId },
        include: { assignments: { include: { user: { select: PUBLIC_USER_SELECT } } } },
      }) : null;
      const incident = document.incidentId ? await tx.incident.findUnique({
        where: { id: document.incidentId },
        include: {
          assignments: { include: { user: { select: PUBLIC_USER_SELECT } } },
          vehicles: { include: { asset: { select: { id: true, name: true } } } },
        },
      }) : null;
      context = JSON.parse(JSON.stringify({ shift, incident, publishedByUserId: actorUserId }));
    }
    const changed = await tx.operationalDocument.updateMany({
      where: { id, revision: input.revision, status: document.status },
      data: {
        status: input.status, revision: { increment: 1 },
        ...(input.status === "PUBLISHED" ? { publishedAt: new Date(), publicationContext: context } : {}),
      },
    });
    if (!changed.count) throw new OperationError(409, "El documento cambio durante la operacion. Recargue la lista.");
    await tx.auditLog.create({
      data: { actorUserId, action: input.status === "PUBLISHED" ? "DOCUMENT_PUBLISHED" : "DOCUMENT_ARCHIVED",
        entityType: "OperationalDocument", entityId: id, metadata: { kind: document.kind, revision: input.revision + 1 } },
    });
    return tx.operationalDocument.findUniqueOrThrow({ where: { id }, include });
  });
}
export async function rectifyDocument(id: string, revision: number, reason: string, actor: Actor) {
  return serializable(async tx => {
    const source = await tx.operationalDocument.findUnique({ where: { id } });
    if (!source || source.status !== "PUBLISHED" || source.revision !== revision) throw new OperationError(409, "El documento cambio o no esta publicado");
    assertWriter(source.kind, actor, source.createdByUserId);
    if (await tx.operationalDocument.findFirst({ where: { sourceDocumentId: id, status: "DRAFT" } })) throw new OperationError(409, "Ya existe una rectificacion pendiente para este documento");
    const draft = await tx.operationalDocument.create({ data: { sourceDocumentId: id, title: source.title, kind: source.kind, category: source.category, body: source.body, externalUrl: source.externalUrl, shiftId: source.shiftId, incidentId: source.incidentId, createdByUserId: actor.userId } });
    await tx.auditLog.create({ data: { actorUserId: actor.userId, action: "DOCUMENT_RECTIFICATION_CREATED", entityType: "OperationalDocument", entityId: draft.id, metadata: { sourceDocumentId: id, reason, sourceRevision: revision } } });
    return draft;
  });
}
