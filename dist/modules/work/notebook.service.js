"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.notebookDeleteSchema = exports.notebookEditSchema = exports.notebookSchema = exports.notebookQuery = exports.notebookCategory = void 0;
exports.listNotebook = listNotebook;
exports.saveNotebook = saveNotebook;
exports.deleteNotebook = deleteNotebook;
const zod_1 = require("zod");
const prisma_1 = require("../../config/prisma");
const transaction_1 = require("../../utils/transaction");
const public_user_1 = require("../../utils/public-user");
const operations_schemas_1 = require("../operations/operations.schemas");
const incident_access_1 = require("../incidents/incident-access");
const work_schemas_1 = require("./work.schemas");
exports.notebookCategory = zod_1.z.enum(["PLACE", "PERSON", "VEHICLE", "AGENCY", "NOTE", "NOVELTY", "THIRD_PARTY", "CORRECTION", "DAMAGE"]);
exports.notebookQuery = work_schemas_1.pageQuery.extend({ category: exports.notebookCategory.optional() });
exports.notebookSchema = zod_1.z.object({ category: exports.notebookCategory, title: zod_1.z.string().trim().min(3).max(160), body: zod_1.z.string().trim().min(3).max(4000), occurredAt: zod_1.z.string().datetime({ offset: true }) });
exports.notebookEditSchema = exports.notebookSchema.extend({ revision: work_schemas_1.revision });
exports.notebookDeleteSchema = zod_1.z.object({ revision: work_schemas_1.revision, notes: zod_1.z.string().trim().min(5).max(2000) });
const include = { author: { select: public_user_1.PUBLIC_USER_SELECT } };
async function incidentAccess(tx, incidentId, write = false) {
    const incident = await tx.incident.findUnique({ where: { id: incidentId }, select: { status: true } });
    if (!incident)
        throw new operations_schemas_1.OperationError(404, "Intervencion no encontrada");
    if (write && incident.status !== "OPEN")
        throw new operations_schemas_1.OperationError(409, "La libreta de una intervencion cerrada es de solo lectura");
}
async function listNotebook(incidentId, query, actor) {
    return prisma_1.prisma.$transaction(async (tx) => {
        await incidentAccess(tx, incidentId);
        const where = { incidentId, deletedAt: null, ...(query.category ? { category: query.category } : {}), ...(query.q ? { OR: [{ title: { contains: query.q, mode: "insensitive" } }, { body: { contains: query.q, mode: "insensitive" } }] } : {}) };
        return { items: await tx.incidentNotebookEntry.findMany({ where, include, orderBy: [{ occurredAt: "desc" }, { id: "desc" }], take: 30, skip: (query.page - 1) * 30 }), total: await tx.incidentNotebookEntry.count({ where }), page: query.page, pageSize: 30 };
    }, { isolationLevel: "RepeatableRead" });
}
async function saveNotebook(incidentId, id, input, actor) {
    const occurredAt = (0, work_schemas_1.assertPast)(input.occurredAt);
    return (0, transaction_1.serializable)(async (tx) => {
        await (0, incident_access_1.requireIncidentWrite)(tx, actor);
        let incidentStatus;
        if (id) {
            await incidentAccess(tx, incidentId, true);
        }
        else {
            const incident = await tx.incident.findUnique({ where: { id: incidentId }, select: { status: true } });
            if (!incident)
                throw new operations_schemas_1.OperationError(404, "Intervencion no encontrada");
            incidentStatus = incident.status;
        }
        const data = { category: input.category, title: input.title, body: input.body, occurredAt };
        let entry;
        if (id) {
            const changed = await tx.incidentNotebookEntry.updateMany({ where: { id, incidentId, ...(actor.role === "ADMIN" ? {} : { authorUserId: actor.userId }), revision: input.revision, deletedAt: null }, data: { ...data, revision: { increment: 1 } } });
            if (!changed.count)
                throw new operations_schemas_1.OperationError(409, "La entrada cambio o no es de su autoria");
            entry = await tx.incidentNotebookEntry.findUniqueOrThrow({ where: { id }, include });
        }
        else
            entry = await tx.incidentNotebookEntry.create({ data: { ...data, incidentId, authorUserId: actor.userId }, include });
        await tx.auditLog.create({ data: { actorUserId: actor.userId, action: id ? "NOTEBOOK_UPDATED" : incidentStatus === "CLOSED" ? "INCIDENT_POST_CLOSURE_ANNEX_CREATED" : "NOTEBOOK_CREATED", entityType: "IncidentNotebookEntry", entityId: entry.id, metadata: { incidentId, revision: entry.revision, appendedAfterClosure: incidentStatus === "CLOSED" } } });
        return entry;
    });
}
async function deleteNotebook(incidentId, id, input, actor) {
    if (!(0, operations_schemas_1.isOperationsManager)(actor.role))
        throw new operations_schemas_1.OperationError(403, "Solo responsables pueden retirar una entrada");
    return (0, transaction_1.serializable)(async (tx) => {
        await (0, incident_access_1.requireIncidentWrite)(tx, actor);
        await incidentAccess(tx, incidentId, true);
        const changed = await tx.incidentNotebookEntry.updateMany({ where: { id, incidentId, revision: input.revision, deletedAt: null }, data: { deletedAt: new Date(), revision: { increment: 1 } } });
        if (!changed.count)
            throw new operations_schemas_1.OperationError(409, "La entrada cambio. Actualice la libreta");
        await tx.auditLog.create({ data: { actorUserId: actor.userId, action: "NOTEBOOK_RETIRED", entityType: "IncidentNotebookEntry", entityId: id, metadata: { incidentId, reason: input.notes } } });
        return { message: "Entrada retirada; historial conservado" };
    });
}
