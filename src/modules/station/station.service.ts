import { prisma } from "../../config/prisma";
import { serializable } from "../../utils/transaction";
import { normalizeRank } from "../../utils/firefighter-ranks";
import { stationDate } from "../../utils/station-time";
import { shiftInterval } from "../shifts/shifts.rules";
import { OperationError } from "../operations/operations.schemas";
import { notify } from "../members/notifications.service";
import { calculateRanking, countsForAverage } from "../ranking/ranking.service";

type Actor = { userId: string; role: string };
const DAY = 86_400_000;
const isManager = (role: string) => ["ADMIN", "OPERATOR"].includes(role);
const activeUser = { isActive: true, isPendingApproval: false, deletedAt: null } as const;
const nameOf = (u: { username: string; profile: { fullName: string } | null }) => u.profile?.fullName || u.username;

/* ------------------------------------------------------------------ */
/* 27: Agenda del cuartel                                               */
/* ------------------------------------------------------------------ */
export const EVENT_KINDS = ["TRAINING", "MEETING", "EVENT", "OTHER"] as const;
const eventLabel: Record<string, string> = { TRAINING: "Capacitación", MEETING: "Reunión", EVENT: "Evento", OTHER: "Actividad" };
const when = (d: Date) => new Intl.DateTimeFormat("es-AR", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone: "America/Argentina/Buenos_Aires" }).format(d);

export async function listEvents(actor: Actor, scope: "upcoming" | "past") {
  const now = new Date();
  const rows = await prisma.stationEvent.findMany({
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

export async function saveEvent(actor: Actor, input: { id?: string; revision?: number; title: string; description: string; kind: string; location: string; startsAt: string; endsAt: string }) {
  if (!isManager(actor.role)) throw new OperationError(403, "Solo jefatura organiza actividades de la agenda");
  const startsAt = new Date(input.startsAt), endsAt = new Date(input.endsAt);
  if (!(endsAt > startsAt)) throw new OperationError(400, "La finalización debe ser posterior al inicio");
  return serializable(async (tx) => {
    const data = { title: input.title, description: input.description, kind: input.kind, location: input.location, startsAt, endsAt };
    if (input.id) {
      const current = await tx.stationEvent.findUnique({ where: { id: input.id } });
      if (!current) throw new OperationError(404, "Actividad no encontrada");
      if (current.cancelledAt) throw new OperationError(409, "La actividad está cancelada");
      const changed = await tx.stationEvent.updateMany({ where: { id: input.id, revision: input.revision }, data: { ...data, revision: { increment: 1 }, reminderSentAt: startsAt.getTime() !== current.startsAt.getTime() ? null : undefined } });
      if (!changed.count) throw new OperationError(409, "Otra persona modificó la actividad; actualice antes de guardar");
      await tx.auditLog.create({ data: { actorUserId: actor.userId, action: "STATION_EVENT_UPDATED", entityType: "StationEvent", entityId: input.id, metadata: { before: { title: current.title, startsAt: current.startsAt, endsAt: current.endsAt, location: current.location }, after: data } } });
      const going = await tx.stationEventRsvp.findMany({ where: { eventId: input.id, response: { in: ["GOING", "MAYBE"] } }, select: { userId: true } });
      await notify(tx, going.map((r) => r.userId), `Cambió una actividad de la agenda: ${input.title}`, "/agenda", when(startsAt));
      return { id: input.id };
    }
    const row = await tx.stationEvent.create({ data: { ...data, createdByUserId: actor.userId } });
    await tx.auditLog.create({ data: { actorUserId: actor.userId, action: "STATION_EVENT_CREATED", entityType: "StationEvent", entityId: row.id, metadata: data } });
    const people = await tx.user.findMany({ where: { ...activeUser, id: { not: actor.userId } }, select: { id: true } });
    await notify(tx, people.map((p) => p.id), `${eventLabel[input.kind] ?? "Actividad"}: ${input.title}`, "/agenda", `${when(startsAt)}${input.location ? ` · ${input.location}` : ""}. Confirmá si vas.`);
    return { id: row.id };
  });
}

export async function cancelEvent(actor: Actor, id: string, reason: string) {
  if (!isManager(actor.role)) throw new OperationError(403, "Solo jefatura cancela actividades");
  return serializable(async (tx) => {
    const row = await tx.stationEvent.findUnique({ where: { id } });
    if (!row) throw new OperationError(404, "Actividad no encontrada");
    if (row.cancelledAt) return { id };
    await tx.stationEvent.update({ where: { id }, data: { cancelledAt: new Date(), cancelReason: reason, revision: { increment: 1 } } });
    await tx.auditLog.create({ data: { actorUserId: actor.userId, action: "STATION_EVENT_CANCELLED", entityType: "StationEvent", entityId: id, metadata: { title: row.title, reason } } });
    const rsvps = await tx.stationEventRsvp.findMany({ where: { eventId: id, response: { in: ["GOING", "MAYBE"] } }, select: { userId: true } });
    await notify(tx, rsvps.map((r) => r.userId), `Se canceló: ${row.title}`, "/agenda", reason);
    return { id };
  });
}

export async function rsvpEvent(actor: Actor, id: string, response: "GOING" | "NOT_GOING" | "MAYBE") {
  return serializable(async (tx) => {
    const row = await tx.stationEvent.findUnique({ where: { id } });
    if (!row || row.cancelledAt) throw new OperationError(409, "La actividad no está disponible");
    if (row.endsAt < new Date()) throw new OperationError(409, "La actividad ya terminó");
    const before = await tx.stationEventRsvp.findUnique({ where: { eventId_userId: { eventId: id, userId: actor.userId } } });
    await tx.stationEventRsvp.upsert({ where: { eventId_userId: { eventId: id, userId: actor.userId } }, create: { eventId: id, userId: actor.userId, response }, update: { response, respondedAt: new Date() } });
    await tx.auditLog.create({ data: { actorUserId: actor.userId, action: "STATION_EVENT_RSVP", entityType: "StationEvent", entityId: id, metadata: { before: before?.response ?? null, after: response } } });
    return { response };
  });
}

/** Recordatorio unico 24 h antes a quien confirmo o todavia no respondio. Lo corre el ciclo de tareas. */
export async function remindUpcomingEvents(now = new Date()) {
  const due = await prisma.stationEvent.findMany({ where: { cancelledAt: null, reminderSentAt: null, startsAt: { gt: now, lte: new Date(now.getTime() + DAY) } }, include: { rsvps: true } });
  for (const event of due) {
    await prisma.$transaction(async (tx) => {
      const claimed = await tx.stationEvent.updateMany({ where: { id: event.id, reminderSentAt: null }, data: { reminderSentAt: now } });
      if (!claimed.count) return;
      const declined = new Set(event.rsvps.filter((r) => r.response === "NOT_GOING").map((r) => r.userId));
      const people = await tx.user.findMany({ where: activeUser, select: { id: true } });
      await notify(tx, people.map((p) => p.id).filter((id) => !declined.has(id)), `Mañana: ${event.title}`, "/agenda", `${when(event.startsAt)}${event.location ? ` · ${event.location}` : ""}`);
    });
  }
  return due.length;
}

/* ------------------------------------------------------------------ */
/* 3: Pedido de refuerzos desde una intervencion abierta                */
/* ------------------------------------------------------------------ */
export async function requestReinforcements(actor: Actor, incidentId: string, input: { message: string; target: "ALL" | "DRIVERS" }) {
  return serializable(async (tx) => {
    const allowed = isManager(actor.role) || actor.role === "GUARD" || Boolean(await tx.attendance.findFirst({ where: { userId: actor.userId, status: "OPEN", checkInQrId: { not: null } }, select: { id: true } }));
    if (!allowed) throw new OperationError(403, "Pide refuerzos jefatura, la guardia o quien está en el cuartel con QR");
    const incident = await tx.incident.findUnique({ where: { id: incidentId }, select: { id: true, title: true, location: true, status: true, voidedAt: true } });
    if (!incident || incident.voidedAt) throw new OperationError(404, "Intervención no encontrada");
    if (incident.status !== "OPEN") throw new OperationError(409, "La intervención ya está cerrada");
    const recent = await tx.auditLog.findFirst({ where: { action: "INCIDENT_REINFORCEMENT_REQUESTED", entityId: incidentId, createdAt: { gt: new Date(Date.now() - 5 * 60_000) } }, select: { id: true } });
    if (recent) throw new OperationError(429, "Ya se pidieron refuerzos hace menos de 5 minutos para esta intervención");
    const now = new Date();
    // Mismo criterio que la convocatoria: personal disponible y sin ausencia vigente. Incluye a quien dijo
    // "No voy": la situacion cambio. Se excluye a quien ya esta en una salida de esta intervencion.
    const busy = new Set((await tx.missionCrew.findMany({ where: { movement: { incidentId, returnedAt: null } }, select: { userId: true } })).map((r) => r.userId));
    let people = await tx.user.findMany({ where: { ...activeUser, emergencyStatusConfirmedAt: { not: null }, emergencyAvailability: { none: { cancelledAt: null, startsAt: { lte: now }, OR: [{ endsAt: null }, { endsAt: { gt: now } }] } } }, select: { id: true, profile: { select: { rank: true } } } });
    people = people.filter((p) => !busy.has(p.id) && p.id !== actor.userId && !["administrador", "comision directiva", "aspirante menor"].includes(normalizeRank(p.profile?.rank)));
    if (input.target === "DRIVERS") {
      const drivers = new Set((await tx.vehicleDriverAuthorization.findMany({ where: { status: "APPROVED", validUntil: { gte: new Date(stationDate()) } }, select: { userId: true } })).map((r) => r.userId));
      people = people.filter((p) => drivers.has(p.id));
    }
    await notify(tx, people.map((p) => p.id), `Se necesitan refuerzos${input.target === "DRIVERS" ? " (choferes)" : ""}: ${incident.title}`, `/incidents/${incidentId}/sheet`, `${incident.location}. ${input.message}`);
    await tx.auditLog.create({ data: { actorUserId: actor.userId, action: "INCIDENT_REINFORCEMENT_REQUESTED", entityType: "Incident", entityId: incidentId, metadata: { target: input.target, message: input.message, notified: people.length } } });
    return { notified: people.length };
  });
}

/* ------------------------------------------------------------------ */
/* 18: Cumplimiento de guardias por persona                              */
/* ------------------------------------------------------------------ */
export async function guardComplianceReport(actor: Actor, month: string) {
  if (!isManager(actor.role)) throw new OperationError(403, "Reporte reservado a jefatura");
  const from = new Date(`${month}-01T00:00:00Z`), to = new Date(from); to.setUTCMonth(to.getUTCMonth() + 1);
  const shifts = await prisma.shift.findMany({ where: { date: { gte: from, lt: to } }, include: { assignments: { include: { user: { select: { id: true, username: true, profile: { select: { fullName: true, rank: true } } } } } } } });
  const now = Date.now();
  const rows = new Map<string, { userId: string; name: string; rank: string; assigned: number; attended: number; missed: number; upcoming: number; missedDates: string[] }>();
  for (const shift of shifts) {
    const { start, end } = shiftInterval(shift.date.toISOString().slice(0, 10), shift.startTime, shift.endTime);
    for (const a of shift.assignments) {
      const row = rows.get(a.userId) ?? { userId: a.userId, name: nameOf(a.user), rank: a.user.profile?.rank ?? "", assigned: 0, attended: 0, missed: 0, upcoming: 0, missedDates: [] };
      rows.set(a.userId, row);
      row.assigned++;
      if (end > now) { row.upcoming++; continue; }
      const present = await prisma.attendance.findFirst({ where: { userId: a.userId, checkInQrId: { not: null }, checkInTrust: { not: "REJECTED" }, discardedAt: null, checkInAt: { lt: new Date(end) }, OR: [{ status: "OPEN" }, { checkOutAt: { gt: new Date(start) } }] }, select: { id: true } });
      if (present) row.attended++; else { row.missed++; row.missedDates.push(shift.date.toISOString().slice(0, 10)); }
    }
  }
  const people = [...rows.values()].map((r) => ({ ...r, rate: r.attended + r.missed ? Math.round((r.attended / (r.attended + r.missed)) * 100) : null })).sort((a, b) => (a.rate ?? 101) - (b.rate ?? 101) || a.name.localeCompare(b.name));
  const done = people.reduce((s, r) => s + r.attended + r.missed, 0), attended = people.reduce((s, r) => s + r.attended, 0);
  return { month, totals: { shifts: shifts.length, finishedAssignments: done, attended, missed: done - attended, rate: done ? Math.round((attended / done) * 100) : null }, people };
}

/* ------------------------------------------------------------------ */
/* 35: Comparativa año contra año                                        */
/* ------------------------------------------------------------------ */
export async function yearComparison(year: number) {
  async function yearData(y: number) {
    const from = new Date(Date.UTC(y, 0, 1, 3)), to = new Date(Date.UTC(y + 1, 0, 1, 3));
    const incidents = await prisma.incident.findMany({ where: { voidedAt: null, occurredAt: { gte: from, lt: to } }, select: { type: true, occurredAt: true, agencies: { where: { voidedAt: null }, select: { agencyType: true } }, alert: { select: { createdAt: true } }, movements: { select: { departedAt: true, arrivedAt: true }, orderBy: { departedAt: "asc" }, take: 1 } } });
    const alerts = await prisma.alert.count({ where: { createdAt: { gte: from, lt: to } } });
    const months = Array.from({ length: 12 }, () => 0);
    const byType: Record<string, number> = {};
    const dispatch: number[] = [], travel: number[] = [];
    // 62: intervenciones con otras instituciones y cuantas veces participo cada tipo.
    const agencies: Record<string, number> = {}; let joint = 0;
    for (const inc of incidents) {
      months[Number(stationDate(inc.occurredAt).slice(5, 7)) - 1]++;
      byType[inc.type] = (byType[inc.type] ?? 0) + 1;
      if (inc.agencies.length) joint++;
      for (const t of new Set(inc.agencies.map((a) => a.agencyType))) agencies[t] = (agencies[t] ?? 0) + 1;
      const first = inc.movements[0];
      if (first && inc.alert) { const m = (first.departedAt.getTime() - inc.alert.createdAt.getTime()) / 60000; if (m >= 0 && m < 240) dispatch.push(m); }
      if (first?.arrivedAt) { const m = (first.arrivedAt.getTime() - first.departedAt.getTime()) / 60000; if (m >= 0 && m < 480) travel.push(m); }
    }
    const median = (v: number[]) => { if (!v.length) return null; const s = [...v].sort((a, b) => a - b), m = Math.floor(s.length / 2); return Math.round((s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) * 10) / 10; };
    return { year: y, incidents: incidents.length, alerts, months, byType, jointIncidents: joint, agencies, medianDispatchMinutes: median(dispatch), medianTravelMinutes: median(travel), samples: { dispatch: dispatch.length, travel: travel.length } };
  }
  const [current, previous] = await Promise.all([yearData(year), yearData(year - 1)]);
  // Para el año en curso se compara contra el mismo periodo del anterior, no contra el año completo.
  const today = new Date(stationDate());
  const sameUntilMonth = year === today.getUTCFullYear() ? today.getUTCMonth() : 11;
  const ytd = (d: { months: number[] }) => d.months.slice(0, sameUntilMonth + 1).reduce((a, b) => a + b, 0);
  return { current, previous, comparableMonths: sameUntilMonth + 1, comparable: { current: ytd(current), previous: ytd(previous) } };
}

/* ------------------------------------------------------------------ */
/* 14: Escalafón y antigüedad                                           */
/* ------------------------------------------------------------------ */
const years = (from: Date | null | undefined, now: Date) => from ? Math.floor(((now.getTime() - from.getTime()) / (365.25 * DAY)) * 10) / 10 : null;

export async function seniority(actor: Actor) {
  if (!isManager(actor.role)) throw new OperationError(403, "Escalafón reservado a jefatura");
  const now = new Date();
  const [rules, users, courses] = await Promise.all([
    prisma.promotionRule.findMany(),
    prisma.user.findMany({ where: activeUser, select: { id: true, username: true, profile: { select: { fullName: true, rank: true, joinDate: true, rankSince: true, badge: true } } } }),
    prisma.courseAttendance.groupBy({ by: ["userId"], where: { status: "APPROVED" }, _count: { _all: true } }),
  ]);
  const courseCount = new Map(courses.map((c) => [c.userId, c._count._all]));
  // Ranking de los ultimos 6 meses completos: se suma el puntaje de cada persona y queda en rango bajo quien
  // esta por debajo de la mitad del promedio (misma regla que el ranking mensual). Tambien cuentan las sanciones vigentes.
  const months = Array.from({ length: 6 }, (_, i) => { const d = new Date(`${stationDate().slice(0, 7)}-01T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() - 1 - i); return d.toISOString().slice(0, 7); });
  const boards = [];
  for (const month of months) boards.push(await prisma.$transaction((tx) => calculateRanking(tx, month), { isolationLevel: "RepeatableRead", timeout: 30000 }));
  const totals = new Map<string, number>();
  for (const board of boards) for (const row of board.rows) totals.set(row.userId, (totals.get(row.userId) ?? 0) + row.points);
  const scoredIds = boards[0]?.rows.filter((r) => countsForAverage(r.rank)).map((r) => r.userId) ?? [];
  const average = scoredIds.length ? scoredIds.reduce((t, id) => t + (totals.get(id) ?? 0), 0) / scoredIds.length : 0;
  const lowLine = Math.round(average / 2 * 10) / 10;
  const today = new Date(stationDate());
  const activeSanctions = await prisma.sanction.findMany({ where: { revokedAt: null, startsOn: { lte: today }, OR: [{ endsOn: null }, { endsOn: { gte: today } }] }, select: { userId: true, kind: true } });
  const ruleFor = (rank?: string | null) => rules.find((r) => normalizeRank(r.rank) === normalizeRank(rank));
  const people = users.filter((u) => u.profile && !["administrador", "guardia"].includes(normalizeRank(u.profile.rank))).map((u) => {
    const p = u.profile!;
    const service = years(p.joinDate, now), inRank = years(p.rankSince ?? p.joinDate, now), approved = courseCount.get(u.id) ?? 0;
    const rule = ruleFor(p.rank);
    const missing: string[] = [];
    if (rule) {
      if (service === null) missing.push("Falta la fecha de ingreso");
      else if (service < rule.minYearsService) missing.push(`Antigüedad ${service} de ${rule.minYearsService} años`);
      if (inRank !== null && inRank < rule.minYearsInRank) missing.push(`En el cargo ${inRank} de ${rule.minYearsInRank} años`);
      if (approved < rule.minApprovedCourses) missing.push(`Cursos ${approved} de ${rule.minApprovedCourses}`);
    }
    const points = totals.get(u.id) ?? 0, low = points < lowLine;
    const sanctions = activeSanctions.filter((s) => s.userId === u.id).length;
    if (rule && low) missing.push(`Ranking: ${points} puntos en 6 meses, debajo de la mitad del promedio (${lowLine})`);
    if (rule && sanctions) missing.push(sanctions === 1 ? "Tiene una sanción vigente" : `Tiene ${sanctions} sanciones vigentes`);
    return { userId: u.id, name: p.fullName || u.username, badge: p.badge, rank: p.rank, joinDate: p.joinDate, rankSince: p.rankSince, rankSinceEstimated: !p.rankSince, yearsService: service, yearsInRank: inRank, approvedCourses: approved, ranking: { points, average: Math.round(average * 10) / 10, lowLine, low, months: months.length }, activeSanctions: sanctions, nextRank: rule?.nextRank ?? null, eligible: Boolean(rule) && missing.length === 0, missing };
  }).sort((a, b) => Number(b.eligible) - Number(a.eligible) || (b.yearsService ?? -1) - (a.yearsService ?? -1));
  return { rules, people };
}

export async function savePromotionRules(actor: Actor, input: Array<{ rank: string; nextRank: string; minYearsInRank: number; minYearsService: number; minApprovedCourses: number }>, reason: string) {
  if (actor.role !== "ADMIN") throw new OperationError(403, "Solo administración y oficiales modifican las reglas de ascenso");
  return serializable(async (tx) => {
    const before = await tx.promotionRule.findMany();
    for (const rule of input) await tx.promotionRule.upsert({ where: { rank: rule.rank }, create: { ...rule, updatedByUserId: actor.userId }, update: { ...rule, updatedByUserId: actor.userId } });
    await tx.auditLog.create({ data: { actorUserId: actor.userId, action: "PROMOTION_RULES_UPDATED", entityType: "PromotionRule", entityId: "all", metadata: { reason, before, after: input } } });
    return tx.promotionRule.findMany();
  });
}

/* ------------------------------------------------------------------ */
/* 30: Biblioteca: registro de lectura por version                       */
/* ------------------------------------------------------------------ */
export async function myDocumentReads(actor: Actor) {
  const rows = await prisma.documentRead.findMany({ where: { userId: actor.userId }, select: { documentId: true, revision: true, readAt: true } });
  return rows;
}
export async function markDocumentRead(actor: Actor, documentId: string) {
  return serializable(async (tx) => {
    const doc = await tx.operationalDocument.findUnique({ where: { id: documentId }, select: { id: true, status: true, revision: true, title: true } });
    if (!doc || doc.status !== "PUBLISHED") throw new OperationError(404, "Documento no disponible");
    const exists = await tx.documentRead.findUnique({ where: { documentId_userId_revision: { documentId, userId: actor.userId, revision: doc.revision } } });
    if (!exists) {
      await tx.documentRead.create({ data: { documentId, userId: actor.userId, revision: doc.revision } });
      await tx.auditLog.create({ data: { actorUserId: actor.userId, action: "DOCUMENT_READ_CONFIRMED", entityType: "OperationalDocument", entityId: documentId, metadata: { revision: doc.revision, title: doc.title } } });
    }
    return { documentId, revision: doc.revision };
  });
}
export async function documentReadReport(actor: Actor, documentId: string) {
  if (!isManager(actor.role)) throw new OperationError(403, "Reporte reservado a jefatura");
  const doc = await prisma.operationalDocument.findUnique({ where: { id: documentId }, select: { id: true, title: true, revision: true, status: true } });
  if (!doc) throw new OperationError(404, "Documento no encontrado");
  const [reads, people] = await Promise.all([
    prisma.documentRead.findMany({ where: { documentId, revision: doc.revision }, select: { userId: true, readAt: true } }),
    prisma.user.findMany({ where: activeUser, select: { id: true, username: true, profile: { select: { fullName: true, rank: true } } } }),
  ]);
  const readAt = new Map(reads.map((r) => [r.userId, r.readAt]));
  const staff = people.filter((p) => normalizeRank(p.profile?.rank) !== "administrador");
  return { document: doc, read: staff.filter((p) => readAt.has(p.id)).map((p) => ({ userId: p.id, name: nameOf(p), rank: p.profile?.rank ?? "", readAt: readAt.get(p.id) })), pending: staff.filter((p) => !readAt.has(p.id)).map((p) => ({ userId: p.id, name: nameOf(p), rank: p.profile?.rank ?? "" })) };
}

/* ------------------------------------------------------------------ */
/* 5: Direcciones frecuentes para el despacho                           */
/* ------------------------------------------------------------------ */
export async function frequentLocations() {
  const since = new Date(Date.now() - 730 * DAY);
  const [alerts, notices] = await Promise.all([
    prisma.alert.findMany({ where: { createdAt: { gte: since } }, select: { location: true }, take: 2000, orderBy: { createdAt: "desc" } }),
    prisma.dispatchNotice.findMany({ where: { receivedAt: { gte: since } }, select: { location: true }, take: 2000, orderBy: { receivedAt: "desc" } }),
  ]);
  const counts = new Map<string, { location: string; uses: number }>();
  for (const row of [...alerts, ...notices]) {
    const location = (row.location ?? "").trim(); if (location.length < 4) continue;
    const key = location.toLocaleLowerCase("es-AR").replace(/\s+/g, " ");
    const current = counts.get(key) ?? { location, uses: 0 }; current.uses++; counts.set(key, current);
  }
  return [...counts.values()].sort((a, b) => b.uses - a.uses).slice(0, 60);
}

/* ------------------------------------------------------------------ */
/* 2: Tablero de comando: intervenciones abiertas y moviles en la calle  */
/* ------------------------------------------------------------------ */
export async function commandBoard() {
  const incidents = await prisma.incident.findMany({
    where: { status: "OPEN", voidedAt: null }, orderBy: { occurredAt: "desc" }, take: 20,
    select: { id: true, title: true, type: true, location: true, occurredAt: true, alert: { select: { priority: true, createdAt: true } },
      agencies: { where: { voidedAt: null, leftAt: null }, select: { id: true, agencyType: true, name: true, unit: true } },
      movements: { where: { returnedAt: null }, orderBy: { departedAt: "asc" }, select: { id: true, departedAt: true, arrivedAt: true, asset: { select: { name: true } }, driver: { select: { username: true, profile: { select: { fullName: true } } } }, leader: { select: { username: true, profile: { select: { fullName: true } } } }, _count: { select: { crew: true } } } } },
  });
  return { generatedAt: new Date(), incidents: incidents.map((i) => ({ ...i, movements: i.movements.map((m) => ({ id: m.id, departedAt: m.departedAt, arrivedAt: m.arrivedAt, vehicle: m.asset.name, driver: nameOf(m.driver), leader: nameOf(m.leader), crew: m._count.crew })) })) };
}
