"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.incidentSheetContext = incidentSheetContext;
exports.finalizeSheet = finalizeSheet;
const express_1 = require("express");
const zod_1 = require("zod");
const prisma_1 = require("../../config/prisma");
const transaction_1 = require("../../utils/transaction");
const incident_access_1 = require("./incident-access");
const public_user_1 = require("../../utils/public-user");
const operations_schemas_1 = require("../operations/operations.schemas");
const reports_service_1 = require("../operations/reports.service");
const unique = (ids) => new Set(ids).size === ids.length;
const form = zod_1.z.object({
    revision: zod_1.z.number().int().min(0), callerName: zod_1.z.string().trim().max(120).optional().default(""), callerPhone: zod_1.z.string().trim().max(40).regex(/^[+\d ()-]*$/).optional().default(""), notes: zod_1.z.string().trim().min(10).max(4000),
    baseUserIds: zod_1.z.array(zod_1.z.string().min(1).max(100)).max(150).refine(unique),
    materials: zod_1.z.array(zod_1.z.object({ name: zod_1.z.string().trim().min(2).max(140), quantity: zod_1.z.number().int().positive().max(100000), notes: zod_1.z.string().trim().max(500) }).strict()).max(100),
    evidenceUrls: zod_1.z.array(zod_1.z.string().url().max(500).refine(value => { try {
        const u = new URL(value);
        return u.protocol === "https:" && !u.username && !u.password;
    }
    catch {
        return false;
    } })).max(5).refine(unique),
}).strict();
async function incidentSheetContext(tx, id, until) {
    const incident = await tx.incident.findUnique({ where: { id }, select: { id: true, title: true, type: true, description: true, location: true, occurredAt: true, closedAt: true, status: true, voidedAt: true, voidReason: true, replacesIncidentId: true,
            alert: { select: { id: true, createdAt: true, contactPhone: true, createdBy: { select: { username: true, profile: { select: { fullName: true } } } }, originNotice: { select: { source: true, phone: true, receivedAt: true } }, responses: { where: { response: "GOING" }, select: { id: true, userId: true, attendanceOutcome: true } } } },
            movements: { orderBy: { departedAt: "asc" }, select: { id: true, asset: { select: { name: true, status: true } }, driverUserId: true, leaderUserId: true, departedAt: true, arrivedAt: true, returnedAt: true, returnWithoutArrivalReason: true, dispatchExceptionReason: true, departure: { select: { voidedAt: true } }, crew: { select: { userId: true, user: { select: public_user_1.PUBLIC_USER_SELECT } } } } } } });
    if (!incident)
        throw new operations_schemas_1.OperationError(404, "Intervención no encontrada");
    if (incident.closedAt && incident.closedAt < until)
        until = incident.closedAt;
    const people = await tx.attendance.findMany({ where: { checkInQrId: { not: null }, checkInAt: { lt: until }, checkInTrust: { not: "REJECTED" }, OR: [{ checkOutAt: { gt: incident.occurredAt } }, { status: "OPEN" }] }, select: { userId: true, checkInAt: true, checkOutAt: true, user: { select: { username: true, profile: { select: { fullName: true } } } } } });
    const missions = people.length ? await tx.missionCrew.findMany({ where: { userId: { in: people.map(p => p.userId) }, movement: { departedAt: { lt: until }, OR: [{ returnedAt: null }, { returnedAt: { gt: incident.occurredAt } }] } }, select: { userId: true, movement: { select: { departedAt: true, returnedAt: true } } } }) : [];
    const base = new Map();
    for (const p of people) {
        const start = Math.max(+incident.occurredAt, +p.checkInAt), end = Math.min(+until, +(p.checkOutAt || until));
        const away = missions.filter(m => m.userId === p.userId).map(m => ({ start: Math.max(start, +m.movement.departedAt), end: Math.min(end, +(m.movement.returnedAt || until)) })).filter(m => m.end > m.start);
        if (end - start > (0, reports_service_1.unionMilliseconds)(away))
            base.set(p.userId, p.user.profile?.fullName || p.user.username);
    }
    // G06/G14: quien recibio la alerta y respondio "Voy" puede figurar en la planilla sin escanear el QR,
    // salvo durante el tiempo en que integro una dotacion en salida.
    const going = incident.alert?.responses.map(r => r.userId).filter(id => !base.has(id)) || [];
    if (going.length) {
        const deployed = new Set(incident.movements.filter(m => +m.departedAt <= +incident.occurredAt && (!m.returnedAt || +m.returnedAt >= +until)).flatMap(m => m.crew.map(c => c.userId)));
        const users = await tx.user.findMany({ where: { id: { in: going }, isActive: true, isPendingApproval: false, deletedAt: null }, select: { id: true, username: true, profile: { select: { fullName: true } } } });
        for (const u of users)
            if (!deployed.has(u.id))
                base.set(u.id, u.profile?.fullName || u.username);
    }
    return { incident, baseCandidates: [...base].map(([id, name]) => ({ id, name })) };
}
async function finalizeSheet(tx, id, now, actor) {
    const data = await incidentSheetContext(tx, id, now);
    let sheet = await tx.incidentSheet.findUnique({ where: { incidentId: id } });
    // G13: con los moviles retornados la intervencion puede finalizarse aunque falten datos;
    // lo pendiente se completa despues mediante anexos (G18).
    const dataPending = !sheet;
    if (!sheet)
        sheet = await tx.incidentSheet.create({ data: { incidentId: id, authorId: actor, callerName: data.incident.alert?.originNotice?.source || "", callerPhone: data.incident.alert?.originNotice?.phone || data.incident.alert?.contactPhone || "", notes: "Intervención finalizada con datos pendientes de carga. Complete la información mediante anexos.", baseUserIds: [], materials: [], evidenceUrls: [] } });
    const staleBase = sheet.baseUserIds.filter(user => !data.baseCandidates.some(p => p.id === user));
    if (staleBase.length)
        throw new operations_schemas_1.OperationError(409, "La presencia en base cambió; revise la planilla");
    const participants = new Set([...sheet.baseUserIds, ...data.incident.movements.filter(m => m.returnedAt && m.departure && !m.departure.voidedAt).flatMap(m => m.crew.map(c => c.userId))]);
    // Decision del cuartel: quien respondio "Voy" y no figura en una dotacion retornada ni en el
    // personal en base pierde esa respuesta, como si nunca la hubiera dado. Queda constancia en auditoria.
    // Sin planilla guardada no hay base para afirmar la inasistencia, asi que no se borra nada.
    const noShows = dataPending ? [] : data.incident.alert?.responses.filter(r => !participants.has(r.userId)) || [];
    const notCredited = noShows.map(r => r.userId);
    if (data.incident.alert && noShows.length) {
        const removed = await tx.alertResponse.deleteMany({ where: { id: { in: noShows.map(r => r.id) }, response: "GOING" } });
        if (removed.count) {
            await tx.auditLog.createMany({ data: noShows.map(response => ({
                    actorUserId: actor,
                    action: "ALERT_GOING_REMOVED_NO_SHOW",
                    entityType: "Alert",
                    entityId: data.incident.alert.id,
                    metadata: { alertId: data.incident.alert.id, incidentId: id, userId: response.userId, removedResponse: "GOING", recordedAt: now.toISOString() },
                })) });
        }
    }
    await tx.incidentSheet.update({ where: { incidentId: id }, data: { finalizedAt: now, revision: { increment: 1 }, finalContext: JSON.parse(JSON.stringify({ ...data, incident: { ...data.incident, status: "CLOSED", closedAt: now }, notCredited, dataPending })) } });
    await tx.auditLog.create({ data: { actorUserId: actor, action: "INCIDENT_SHEET_FINALIZED", entityType: "Incident", entityId: id, metadata: { sheetAuthor: sheet.authorId, participants: [...participants], unconfirmedGoing: notCredited, dataPending } } });
}
const router = (0, express_1.Router)({ mergeParams: true });
router.get("/", async (req, res) => {
    const { id } = zod_1.z.object({ id: zod_1.z.string().min(1) }).parse(req.params), actor = req.user;
    res.json(await prisma_1.prisma.$transaction(async (tx) => {
        const sheet = await tx.incidentSheet.findUnique({ where: { incidentId: id }, include: { author: { select: { username: true } } } });
        const mayWrite = await (0, incident_access_1.canWriteIncident)(tx, actor);
        if (sheet?.finalizedAt) {
            const state = await tx.incident.findUniqueOrThrow({ where: { id }, select: { voidedAt: true, voidReason: true, replacesIncidentId: true } });
            sheet.finalContext = { ...sheet.finalContext, incident: { ...(sheet.finalContext.incident), ...state } };
            const amendments = await tx.auditLog.findMany({ where: { entityType: "Incident", entityId: id, action: "INCIDENT_SHEET_AMENDED" }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true, createdAt: true, metadata: true, actor: { select: { username: true } } } });
            const notebookEntries = await tx.incidentNotebookEntry.findMany({ where: { incidentId: id, deletedAt: null }, include: { author: { select: public_user_1.PUBLIC_USER_SELECT } }, orderBy: [{ occurredAt: "asc" }, { id: "asc" }], take: 500 });
            return { sheet, context: sheet.finalContext, canWrite: false, canAddAnnex: mayWrite, amendments, notebookEntries };
        }
        const current = await incidentSheetContext(tx, id, new Date());
        const notebookEntries = await tx.incidentNotebookEntry.findMany({ where: { incidentId: id, deletedAt: null }, include: { author: { select: public_user_1.PUBLIC_USER_SELECT } }, orderBy: [{ occurredAt: "asc" }, { id: "asc" }], take: 500 });
        return { sheet, context: current, canWrite: current.incident.status === "OPEN" && mayWrite, canAddAnnex: current.incident.status === "CLOSED" && mayWrite, notebookEntries };
    }, { isolationLevel: "RepeatableRead" }));
});
router.put("/", async (req, res) => {
    const { id } = zod_1.z.object({ id: zod_1.z.string().min(1) }).parse(req.params), actor = req.user, { revision, ...data } = form.parse(req.body);
    res.json(await (0, transaction_1.serializable)(async (tx) => {
        await tx.$queryRaw `SELECT "id" FROM "Incident" WHERE "id" = ${id} FOR UPDATE`;
        await (0, incident_access_1.requireIncidentWrite)(tx, actor);
        const snapshot = await incidentSheetContext(tx, id, new Date());
        if (snapshot.incident.status !== "OPEN")
            throw new operations_schemas_1.OperationError(409, "La intervención está cerrada");
        const old = await tx.incidentSheet.findUnique({ where: { incidentId: id } });
        if ((old?.revision || 0) !== revision)
            throw new operations_schemas_1.OperationError(409, "La planilla cambió. Recargue antes de editar");
        if (data.baseUserIds.some(user => !snapshot.baseCandidates.some(p => p.id === user)))
            throw new operations_schemas_1.OperationError(400, "Seleccione personal con presencia QR durante la intervención o que haya respondido Voy a la convocatoria");
        const row = old ? await tx.incidentSheet.update({ where: { incidentId: id }, data: { ...data, revision: { increment: 1 } } }) : await tx.incidentSheet.create({ data: { ...data, incidentId: id, authorId: actor.userId } });
        await tx.auditLog.create({ data: { actorUserId: actor.userId, action: old ? "INCIDENT_SHEET_UPDATED" : "INCIDENT_SHEET_CREATED", entityType: "Incident", entityId: id, metadata: { revision: row.revision, before: old ? { callerName: old.callerName, callerPhone: old.callerPhone, notes: old.notes, materials: old.materials, baseUserIds: old.baseUserIds, evidenceUrls: old.evidenceUrls } : null, after: data } } });
        return row;
    }));
});
router.post("/amendments", async (req, res) => {
    const actor = req.user, { id } = zod_1.z.object({ id: zod_1.z.string().min(1) }).parse(req.params);
    if (!["ADMIN", "OPERATOR"].includes(actor.role))
        throw new operations_schemas_1.OperationError(403, "Solo jefatura puede agregar enmiendas a una planilla cerrada");
    const input = zod_1.z.object({ revision: zod_1.z.number().int().positive(), reason: zod_1.z.string().trim().min(10).max(1000), correction: zod_1.z.string().trim().min(10).max(4000) }).strict().parse(req.body);
    res.status(201).json(await (0, transaction_1.serializable)(async (tx) => {
        const sheet = await tx.incidentSheet.findUnique({ where: { incidentId: id } });
        if (!sheet?.finalizedAt)
            throw new operations_schemas_1.OperationError(409, "Solo se enmiendan planillas finalizadas");
        const changed = await tx.incidentSheet.updateMany({ where: { incidentId: id, revision: input.revision, finalizedAt: { not: null } }, data: { revision: { increment: 1 } } });
        if (!changed.count)
            throw new operations_schemas_1.OperationError(409, "La planilla cambió. Recargue antes de agregar la enmienda");
        return tx.auditLog.create({ data: { actorUserId: actor.userId, action: "INCIDENT_SHEET_AMENDED", entityType: "Incident", entityId: id, metadata: { reason: input.reason, correction: input.correction, sourceRevision: input.revision, revision: input.revision + 1 } }, select: { id: true, createdAt: true } });
    }));
});
exports.default = router;
