"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EVENT_KINDS = void 0;
exports.listEvents = listEvents;
exports.saveEvent = saveEvent;
exports.cancelEvent = cancelEvent;
exports.rsvpEvent = rsvpEvent;
exports.remindUpcomingEvents = remindUpcomingEvents;
exports.requestReinforcements = requestReinforcements;
exports.guardComplianceReport = guardComplianceReport;
exports.yearComparison = yearComparison;
exports.seniority = seniority;
exports.savePromotionRules = savePromotionRules;
exports.myDocumentReads = myDocumentReads;
exports.markDocumentRead = markDocumentRead;
exports.documentReadReport = documentReadReport;
exports.frequentLocations = frequentLocations;
exports.commandBoard = commandBoard;
const prisma_1 = require("../../config/prisma");
const transaction_1 = require("../../utils/transaction");
const firefighter_ranks_1 = require("../../utils/firefighter-ranks");
const station_time_1 = require("../../utils/station-time");
const shifts_rules_1 = require("../shifts/shifts.rules");
const operations_schemas_1 = require("../operations/operations.schemas");
const notifications_service_1 = require("../members/notifications.service");
const DAY = 86400000;
const isManager = (role) => ["ADMIN", "OPERATOR"].includes(role);
const activeUser = { isActive: true, isPendingApproval: false, deletedAt: null };
const nameOf = (u) => u.profile?.fullName || u.username;
/* ------------------------------------------------------------------ */
/* 27: Agenda del cuartel                                               */
/* ------------------------------------------------------------------ */
exports.EVENT_KINDS = ["TRAINING", "MEETING", "EVENT", "OTHER"];
const eventLabel = { TRAINING: "Capacitación", MEETING: "Reunión", EVENT: "Evento", OTHER: "Actividad" };
const when = (d) => new Intl.DateTimeFormat("es-AR", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone: "America/Argentina/Buenos_Aires" }).format(d);
async function listEvents(actor, scope) {
    const now = new Date();
    const rows = await prisma_1.prisma.stationEvent.findMany({
        where: scope === "upcoming" ? { endsAt: { gte: now } } : { endsAt: { lt: now, gte: new Date(now.getTime() - 120 * DAY) } },
        orderBy: { startsAt: scope === "upcoming" ? "asc" : "desc" }, take: 100,
        include: { createdBy: { select: { id: true, username: true, profile: { select: { fullName: true } } } }, rsvps: { include: { user: { select: { id: true, username: true, profile: { select: { fullName: true } } } } } } },
    });
    return rows.map(({ rsvps, createdBy, ...event }) => ({
        ...event,
        createdBy: { id: createdBy.id, name: nameOf(createdBy) },
        counts: { GOING: rsvps.filter((r) => r.response === "GOING").length, MAYBE: rsvps.filter((r) => r.response === "MAYBE").length, NOT_GOING: rsvps.filter((r) => r.response === "NOT_GOING").length },
        myResponse: rsvps.find((r) => r.userId === actor.userId)?.response ?? null,
        // El detalle de quién va lo ve jefatura y quien organiza.
        attendees: isManager(actor.role) || createdBy.id === actor.userId ? rsvps.map((r) => ({ userId: r.userId, name: nameOf(r.user), response: r.response })) : undefined,
    }));
}
async function saveEvent(actor, input) {
    if (!isManager(actor.role))
        throw new operations_schemas_1.OperationError(403, "Solo jefatura organiza actividades de la agenda");
    const startsAt = new Date(input.startsAt), endsAt = new Date(input.endsAt);
    if (!(endsAt > startsAt))
        throw new operations_schemas_1.OperationError(400, "La finalización debe ser posterior al inicio");
    return (0, transaction_1.serializable)(async (tx) => {
        const data = { title: input.title, description: input.description, kind: input.kind, location: input.location, startsAt, endsAt };
        if (input.id) {
            const current = await tx.stationEvent.findUnique({ where: { id: input.id } });
            if (!current)
                throw new operations_schemas_1.OperationError(404, "Actividad no encontrada");
            if (current.cancelledAt)
                throw new operations_schemas_1.OperationError(409, "La actividad está cancelada");
            const changed = await tx.stationEvent.updateMany({ where: { id: input.id, revision: input.revision }, data: { ...data, revision: { increment: 1 }, reminderSentAt: startsAt.getTime() !== current.startsAt.getTime() ? null : undefined } });
            if (!changed.count)
                throw new operations_schemas_1.OperationError(409, "Otra persona modificó la actividad; actualice antes de guardar");
            await tx.auditLog.create({ data: { actorUserId: actor.userId, action: "STATION_EVENT_UPDATED", entityType: "StationEvent", entityId: input.id, metadata: { before: { title: current.title, startsAt: current.startsAt, endsAt: current.endsAt, location: current.location }, after: data } } });
            const going = await tx.stationEventRsvp.findMany({ where: { eventId: input.id, response: { in: ["GOING", "MAYBE"] } }, select: { userId: true } });
            await (0, notifications_service_1.notify)(tx, going.map((r) => r.userId), `Cambió una actividad de la agenda: ${input.title}`, "/agenda", when(startsAt));
            return { id: input.id };
        }
        const row = await tx.stationEvent.create({ data: { ...data, createdByUserId: actor.userId } });
        await tx.auditLog.create({ data: { actorUserId: actor.userId, action: "STATION_EVENT_CREATED", entityType: "StationEvent", entityId: row.id, metadata: data } });
        const people = await tx.user.findMany({ where: { ...activeUser, id: { not: actor.userId } }, select: { id: true } });
        await (0, notifications_service_1.notify)(tx, people.map((p) => p.id), `${eventLabel[input.kind] ?? "Actividad"}: ${input.title}`, "/agenda", `${when(startsAt)}${input.location ? ` · ${input.location}` : ""}. Confirmá si vas.`);
        return { id: row.id };
    });
}
async function cancelEvent(actor, id, reason) {
    if (!isManager(actor.role))
        throw new operations_schemas_1.OperationError(403, "Solo jefatura cancela actividades");
    return (0, transaction_1.serializable)(async (tx) => {
        const row = await tx.stationEvent.findUnique({ where: { id } });
        if (!row)
            throw new operations_schemas_1.OperationError(404, "Actividad no encontrada");
        if (row.cancelledAt)
            return { id };
        await tx.stationEvent.update({ where: { id }, data: { cancelledAt: new Date(), cancelReason: reason, revision: { increment: 1 } } });
        await tx.auditLog.create({ data: { actorUserId: actor.userId, action: "STATION_EVENT_CANCELLED", entityType: "StationEvent", entityId: id, metadata: { title: row.title, reason } } });
        const rsvps = await tx.stationEventRsvp.findMany({ where: { eventId: id, response: { in: ["GOING", "MAYBE"] } }, select: { userId: true } });
        await (0, notifications_service_1.notify)(tx, rsvps.map((r) => r.userId), `Se canceló: ${row.title}`, "/agenda", reason);
        return { id };
    });
}
async function rsvpEvent(actor, id, response) {
    return (0, transaction_1.serializable)(async (tx) => {
        const row = await tx.stationEvent.findUnique({ where: { id } });
        if (!row || row.cancelledAt)
            throw new operations_schemas_1.OperationError(409, "La actividad no está disponible");
        if (row.endsAt < new Date())
            throw new operations_schemas_1.OperationError(409, "La actividad ya terminó");
        const before = await tx.stationEventRsvp.findUnique({ where: { eventId_userId: { eventId: id, userId: actor.userId } } });
        await tx.stationEventRsvp.upsert({ where: { eventId_userId: { eventId: id, userId: actor.userId } }, create: { eventId: id, userId: actor.userId, response }, update: { response, respondedAt: new Date() } });
        await tx.auditLog.create({ data: { actorUserId: actor.userId, action: "STATION_EVENT_RSVP", entityType: "StationEvent", entityId: id, metadata: { before: before?.response ?? null, after: response } } });
        return { response };
    });
}
/** Recordatorio unico 24 h antes a quien confirmo o todavia no respondio. Lo corre el ciclo de tareas. */
async function remindUpcomingEvents(now = new Date()) {
    const due = await prisma_1.prisma.stationEvent.findMany({ where: { cancelledAt: null, reminderSentAt: null, startsAt: { gt: now, lte: new Date(now.getTime() + DAY) } }, include: { rsvps: true } });
    for (const event of due) {
        await prisma_1.prisma.$transaction(async (tx) => {
            const claimed = await tx.stationEvent.updateMany({ where: { id: event.id, reminderSentAt: null }, data: { reminderSentAt: now } });
            if (!claimed.count)
                return;
            const declined = new Set(event.rsvps.filter((r) => r.response === "NOT_GOING").map((r) => r.userId));
            const people = await tx.user.findMany({ where: activeUser, select: { id: true } });
            await (0, notifications_service_1.notify)(tx, people.map((p) => p.id).filter((id) => !declined.has(id)), `Mañana: ${event.title}`, "/agenda", `${when(event.startsAt)}${event.location ? ` · ${event.location}` : ""}`);
        });
    }
    return due.length;
}
/* ------------------------------------------------------------------ */
/* 3: Pedido de refuerzos desde una intervencion abierta                */
/* ------------------------------------------------------------------ */
async function requestReinforcements(actor, incidentId, input) {
    return (0, transaction_1.serializable)(async (tx) => {
        const allowed = isManager(actor.role) || actor.role === "GUARD" || Boolean(await tx.attendance.findFirst({ where: { userId: actor.userId, status: "OPEN", checkInQrId: { not: null } }, select: { id: true } }));
        if (!allowed)
            throw new operations_schemas_1.OperationError(403, "Pide refuerzos jefatura, la guardia o quien está en el cuartel con QR");
        const incident = await tx.incident.findUnique({ where: { id: incidentId }, select: { id: true, title: true, location: true, status: true, voidedAt: true } });
        if (!incident || incident.voidedAt)
            throw new operations_schemas_1.OperationError(404, "Intervención no encontrada");
        if (incident.status !== "OPEN")
            throw new operations_schemas_1.OperationError(409, "La intervención ya está cerrada");
        const recent = await tx.auditLog.findFirst({ where: { action: "INCIDENT_REINFORCEMENT_REQUESTED", entityId: incidentId, createdAt: { gt: new Date(Date.now() - 5 * 60000) } }, select: { id: true } });
        if (recent)
            throw new operations_schemas_1.OperationError(429, "Ya se pidieron refuerzos hace menos de 5 minutos para esta intervención");
        const now = new Date();
        // Mismo criterio que la convocatoria: personal disponible y sin ausencia vigente. Incluye a quien dijo
        // "No voy": la situacion cambio. Se excluye a quien ya esta en una salida de esta intervencion.
        const busy = new Set((await tx.missionCrew.findMany({ where: { movement: { incidentId, returnedAt: null } }, select: { userId: true } })).map((r) => r.userId));
        let people = await tx.user.findMany({ where: { ...activeUser, emergencyStatusConfirmedAt: { not: null }, emergencyAvailability: { none: { cancelledAt: null, startsAt: { lte: now }, OR: [{ endsAt: null }, { endsAt: { gt: now } }] } } }, select: { id: true, profile: { select: { rank: true } } } });
        people = people.filter((p) => !busy.has(p.id) && p.id !== actor.userId && !["administrador", "comision directiva", "aspirante menor"].includes((0, firefighter_ranks_1.normalizeRank)(p.profile?.rank)));
        if (input.target === "DRIVERS") {
            const drivers = new Set((await tx.vehicleDriverAuthorization.findMany({ where: { validUntil: { gte: new Date((0, station_time_1.stationDate)()) } }, select: { userId: true } })).map((r) => r.userId));
            people = people.filter((p) => drivers.has(p.id));
        }
        await (0, notifications_service_1.notify)(tx, people.map((p) => p.id), `Se necesitan refuerzos${input.target === "DRIVERS" ? " (choferes)" : ""}: ${incident.title}`, `/incidents/${incidentId}/sheet`, `${incident.location}. ${input.message}`);
        await tx.auditLog.create({ data: { actorUserId: actor.userId, action: "INCIDENT_REINFORCEMENT_REQUESTED", entityType: "Incident", entityId: incidentId, metadata: { target: input.target, message: input.message, notified: people.length } } });
        return { notified: people.length };
    });
}
/* ------------------------------------------------------------------ */
/* 18: Cumplimiento de guardias por persona                              */
/* ------------------------------------------------------------------ */
async function guardComplianceReport(actor, month) {
    if (!isManager(actor.role))
        throw new operations_schemas_1.OperationError(403, "Reporte reservado a jefatura");
    const from = new Date(`${month}-01T00:00:00Z`), to = new Date(from);
    to.setUTCMonth(to.getUTCMonth() + 1);
    const shifts = await prisma_1.prisma.shift.findMany({ where: { date: { gte: from, lt: to } }, include: { assignments: { include: { user: { select: { id: true, username: true, profile: { select: { fullName: true, rank: true } } } } } } } });
    const now = Date.now();
    const rows = new Map();
    for (const shift of shifts) {
        const { start, end } = (0, shifts_rules_1.shiftInterval)(shift.date.toISOString().slice(0, 10), shift.startTime, shift.endTime);
        for (const a of shift.assignments) {
            const row = rows.get(a.userId) ?? { userId: a.userId, name: nameOf(a.user), rank: a.user.profile?.rank ?? "", assigned: 0, attended: 0, missed: 0, upcoming: 0, missedDates: [] };
            rows.set(a.userId, row);
            row.assigned++;
            if (end > now) {
                row.upcoming++;
                continue;
            }
            const present = await prisma_1.prisma.attendance.findFirst({ where: { userId: a.userId, checkInQrId: { not: null }, checkInTrust: { not: "REJECTED" }, discardedAt: null, checkInAt: { lt: new Date(end) }, OR: [{ status: "OPEN" }, { checkOutAt: { gt: new Date(start) } }] }, select: { id: true } });
            if (present)
                row.attended++;
            else {
                row.missed++;
                row.missedDates.push(shift.date.toISOString().slice(0, 10));
            }
        }
    }
    const people = [...rows.values()].map((r) => ({ ...r, rate: r.attended + r.missed ? Math.round((r.attended / (r.attended + r.missed)) * 100) : null })).sort((a, b) => (a.rate ?? 101) - (b.rate ?? 101) || a.name.localeCompare(b.name));
    const done = people.reduce((s, r) => s + r.attended + r.missed, 0), attended = people.reduce((s, r) => s + r.attended, 0);
    return { month, totals: { shifts: shifts.length, finishedAssignments: done, attended, missed: done - attended, rate: done ? Math.round((attended / done) * 100) : null }, people };
}
/* ------------------------------------------------------------------ */
/* 35: Comparativa año contra año                                        */
/* ------------------------------------------------------------------ */
async function yearComparison(year) {
    async function yearData(y) {
        const from = new Date(Date.UTC(y, 0, 1, 3)), to = new Date(Date.UTC(y + 1, 0, 1, 3));
        const incidents = await prisma_1.prisma.incident.findMany({ where: { voidedAt: null, occurredAt: { gte: from, lt: to } }, select: { type: true, occurredAt: true, alert: { select: { createdAt: true } }, movements: { select: { departedAt: true, arrivedAt: true }, orderBy: { departedAt: "asc" }, take: 1 } } });
        const alerts = await prisma_1.prisma.alert.count({ where: { createdAt: { gte: from, lt: to } } });
        const months = Array.from({ length: 12 }, () => 0);
        const byType = {};
        const dispatch = [], travel = [];
        for (const inc of incidents) {
            months[Number((0, station_time_1.stationDate)(inc.occurredAt).slice(5, 7)) - 1]++;
            byType[inc.type] = (byType[inc.type] ?? 0) + 1;
            const first = inc.movements[0];
            if (first && inc.alert) {
                const m = (first.departedAt.getTime() - inc.alert.createdAt.getTime()) / 60000;
                if (m >= 0 && m < 240)
                    dispatch.push(m);
            }
            if (first?.arrivedAt) {
                const m = (first.arrivedAt.getTime() - first.departedAt.getTime()) / 60000;
                if (m >= 0 && m < 480)
                    travel.push(m);
            }
        }
        const median = (v) => { if (!v.length)
            return null; const s = [...v].sort((a, b) => a - b), m = Math.floor(s.length / 2); return Math.round((s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) * 10) / 10; };
        return { year: y, incidents: incidents.length, alerts, months, byType, medianDispatchMinutes: median(dispatch), medianTravelMinutes: median(travel), samples: { dispatch: dispatch.length, travel: travel.length } };
    }
    const [current, previous] = await Promise.all([yearData(year), yearData(year - 1)]);
    // Para el año en curso se compara contra el mismo periodo del anterior, no contra el año completo.
    const today = new Date((0, station_time_1.stationDate)());
    const sameUntilMonth = year === today.getUTCFullYear() ? today.getUTCMonth() : 11;
    const ytd = (d) => d.months.slice(0, sameUntilMonth + 1).reduce((a, b) => a + b, 0);
    return { current, previous, comparableMonths: sameUntilMonth + 1, comparable: { current: ytd(current), previous: ytd(previous) } };
}
/* ------------------------------------------------------------------ */
/* 14: Escalafón y antigüedad                                           */
/* ------------------------------------------------------------------ */
const years = (from, now) => from ? Math.floor(((now.getTime() - from.getTime()) / (365.25 * DAY)) * 10) / 10 : null;
async function seniority(actor) {
    if (!isManager(actor.role))
        throw new operations_schemas_1.OperationError(403, "Escalafón reservado a jefatura");
    const now = new Date();
    const [rules, users, courses] = await Promise.all([
        prisma_1.prisma.promotionRule.findMany(),
        prisma_1.prisma.user.findMany({ where: activeUser, select: { id: true, username: true, profile: { select: { fullName: true, rank: true, joinDate: true, rankSince: true, badge: true } } } }),
        prisma_1.prisma.courseAttendance.groupBy({ by: ["userId"], where: { status: "APPROVED" }, _count: { _all: true } }),
    ]);
    const courseCount = new Map(courses.map((c) => [c.userId, c._count._all]));
    const ruleFor = (rank) => rules.find((r) => (0, firefighter_ranks_1.normalizeRank)(r.rank) === (0, firefighter_ranks_1.normalizeRank)(rank));
    const people = users.filter((u) => u.profile && !["administrador", "guardia"].includes((0, firefighter_ranks_1.normalizeRank)(u.profile.rank))).map((u) => {
        const p = u.profile;
        const service = years(p.joinDate, now), inRank = years(p.rankSince ?? p.joinDate, now), approved = courseCount.get(u.id) ?? 0;
        const rule = ruleFor(p.rank);
        const missing = [];
        if (rule) {
            if (service === null)
                missing.push("Falta la fecha de ingreso");
            else if (service < rule.minYearsService)
                missing.push(`Antigüedad ${service} de ${rule.minYearsService} años`);
            if (inRank !== null && inRank < rule.minYearsInRank)
                missing.push(`En el cargo ${inRank} de ${rule.minYearsInRank} años`);
            if (approved < rule.minApprovedCourses)
                missing.push(`Cursos ${approved} de ${rule.minApprovedCourses}`);
        }
        return { userId: u.id, name: p.fullName || u.username, badge: p.badge, rank: p.rank, joinDate: p.joinDate, rankSince: p.rankSince, rankSinceEstimated: !p.rankSince, yearsService: service, yearsInRank: inRank, approvedCourses: approved, nextRank: rule?.nextRank ?? null, eligible: Boolean(rule) && missing.length === 0, missing };
    }).sort((a, b) => Number(b.eligible) - Number(a.eligible) || (b.yearsService ?? -1) - (a.yearsService ?? -1));
    return { rules, people };
}
async function savePromotionRules(actor, input, reason) {
    if (actor.role !== "ADMIN")
        throw new operations_schemas_1.OperationError(403, "Solo administración y oficiales modifican las reglas de ascenso");
    return (0, transaction_1.serializable)(async (tx) => {
        const before = await tx.promotionRule.findMany();
        for (const rule of input)
            await tx.promotionRule.upsert({ where: { rank: rule.rank }, create: { ...rule, updatedByUserId: actor.userId }, update: { ...rule, updatedByUserId: actor.userId } });
        await tx.auditLog.create({ data: { actorUserId: actor.userId, action: "PROMOTION_RULES_UPDATED", entityType: "PromotionRule", entityId: "all", metadata: { reason, before, after: input } } });
        return tx.promotionRule.findMany();
    });
}
/* ------------------------------------------------------------------ */
/* 30: Biblioteca: registro de lectura por version                       */
/* ------------------------------------------------------------------ */
async function myDocumentReads(actor) {
    const rows = await prisma_1.prisma.documentRead.findMany({ where: { userId: actor.userId }, select: { documentId: true, revision: true, readAt: true } });
    return rows;
}
async function markDocumentRead(actor, documentId) {
    return (0, transaction_1.serializable)(async (tx) => {
        const doc = await tx.operationalDocument.findUnique({ where: { id: documentId }, select: { id: true, status: true, revision: true, title: true } });
        if (!doc || doc.status !== "PUBLISHED")
            throw new operations_schemas_1.OperationError(404, "Documento no disponible");
        const exists = await tx.documentRead.findUnique({ where: { documentId_userId_revision: { documentId, userId: actor.userId, revision: doc.revision } } });
        if (!exists) {
            await tx.documentRead.create({ data: { documentId, userId: actor.userId, revision: doc.revision } });
            await tx.auditLog.create({ data: { actorUserId: actor.userId, action: "DOCUMENT_READ_CONFIRMED", entityType: "OperationalDocument", entityId: documentId, metadata: { revision: doc.revision, title: doc.title } } });
        }
        return { documentId, revision: doc.revision };
    });
}
async function documentReadReport(actor, documentId) {
    if (!isManager(actor.role))
        throw new operations_schemas_1.OperationError(403, "Reporte reservado a jefatura");
    const doc = await prisma_1.prisma.operationalDocument.findUnique({ where: { id: documentId }, select: { id: true, title: true, revision: true, status: true } });
    if (!doc)
        throw new operations_schemas_1.OperationError(404, "Documento no encontrado");
    const [reads, people] = await Promise.all([
        prisma_1.prisma.documentRead.findMany({ where: { documentId, revision: doc.revision }, select: { userId: true, readAt: true } }),
        prisma_1.prisma.user.findMany({ where: activeUser, select: { id: true, username: true, profile: { select: { fullName: true, rank: true } } } }),
    ]);
    const readAt = new Map(reads.map((r) => [r.userId, r.readAt]));
    const staff = people.filter((p) => (0, firefighter_ranks_1.normalizeRank)(p.profile?.rank) !== "administrador");
    return { document: doc, read: staff.filter((p) => readAt.has(p.id)).map((p) => ({ userId: p.id, name: nameOf(p), rank: p.profile?.rank ?? "", readAt: readAt.get(p.id) })), pending: staff.filter((p) => !readAt.has(p.id)).map((p) => ({ userId: p.id, name: nameOf(p), rank: p.profile?.rank ?? "" })) };
}
/* ------------------------------------------------------------------ */
/* 5: Direcciones frecuentes para el despacho                           */
/* ------------------------------------------------------------------ */
async function frequentLocations() {
    const since = new Date(Date.now() - 730 * DAY);
    const [alerts, notices] = await Promise.all([
        prisma_1.prisma.alert.findMany({ where: { createdAt: { gte: since } }, select: { location: true }, take: 2000, orderBy: { createdAt: "desc" } }),
        prisma_1.prisma.dispatchNotice.findMany({ where: { receivedAt: { gte: since } }, select: { location: true }, take: 2000, orderBy: { receivedAt: "desc" } }),
    ]);
    const counts = new Map();
    for (const row of [...alerts, ...notices]) {
        const location = (row.location ?? "").trim();
        if (location.length < 4)
            continue;
        const key = location.toLocaleLowerCase("es-AR").replace(/\s+/g, " ");
        const current = counts.get(key) ?? { location, uses: 0 };
        current.uses++;
        counts.set(key, current);
    }
    return [...counts.values()].sort((a, b) => b.uses - a.uses).slice(0, 60);
}
/* ------------------------------------------------------------------ */
/* 2: Tablero de comando: intervenciones abiertas y moviles en la calle  */
/* ------------------------------------------------------------------ */
async function commandBoard() {
    const incidents = await prisma_1.prisma.incident.findMany({
        where: { status: "OPEN", voidedAt: null }, orderBy: { occurredAt: "desc" }, take: 20,
        select: { id: true, title: true, type: true, location: true, occurredAt: true, alert: { select: { priority: true, createdAt: true } },
            movements: { where: { returnedAt: null }, orderBy: { departedAt: "asc" }, select: { id: true, departedAt: true, arrivedAt: true, asset: { select: { name: true } }, driver: { select: { username: true, profile: { select: { fullName: true } } } }, leader: { select: { username: true, profile: { select: { fullName: true } } } }, _count: { select: { crew: true } } } } },
    });
    return { generatedAt: new Date(), incidents: incidents.map((i) => ({ ...i, movements: i.movements.map((m) => ({ id: m.id, departedAt: m.departedAt, arrivedAt: m.arrivedAt, vehicle: m.asset.name, driver: nameOf(m.driver), leader: nameOf(m.leader), crew: m._count.crew })) })) };
}
