import { enableAutoStepUp } from "./step-up-test-helper";
import { purgeAuditLogs } from "../utils/audit-purge";
import "dotenv/config";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";
import { stationDate } from "../utils/station-time";

// Funciones del cuartel: agenda, refuerzos, bolsa de reemplazos, mensajes por grupo, reportes,
// escalafon, biblioteca, direcciones frecuentes y tablero. Corre en un esquema aislado.
async function main() {
  if (process.env.NODE_ENV === "production") throw Error("No se prueba en producción");
  const original = process.env.DATABASE_URL!, schema = "station_verify_" + randomBytes(8).toString("hex"), url = new URL(original);
  url.searchParams.set("schema", schema);
  const root = new PrismaClient({ datasourceUrl: original });
  let db: PrismaClient | undefined, server: import("node:http").Server | undefined;
  try {
    execFileSync(process.execPath, [require.resolve("prisma/build/index.js"), "migrate", "deploy"], { env: { ...process.env, DATABASE_URL: url.toString() }, stdio: "pipe" });
    process.env.DATABASE_URL = url.toString();
    const { prisma } = await import("../config/prisma"); db = prisma;
    const { app } = await import("../app");
    server = app.listen(0, "127.0.0.1"); await new Promise<void>((r) => server!.once("listening", r));
    const address = server.address(); assert(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}/api`;
    let paths = 0;
    async function call(path: string, status: number, token?: string, method = "GET", body?: unknown) {
      const response = await fetch(base + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
      const data = await response.json();
      assert.equal(response.status, status, `${method} ${path}: ${JSON.stringify(data)}`); paths++; return data;
    }
    const password = randomUUID() + "!Aa7", passwordHash = await bcrypt.hash(password, 10);
    enableAutoStepUp(() => password);
    const ranks = ["Administrador", "Oficial", "Sub oficial", "Bombero", "Bombero", "Guardia", "Bombero"];
    const users: Array<{ id: string }> = [], tokens: string[] = [];
    for (const [i, rank] of ranks.entries()) {
      const user = await prisma.user.create({ data: { username: "station_test_" + i, role: i === 0 ? "ADMIN" : "FIREFIGHTER", passwordHash, emergencyStatusConfirmedAt: [3, 4].includes(i) ? new Date() : null, profile: { create: { rank, fullName: "Prueba cuartel " + i, dni: "ST-" + i, badge: "ST-" + i, joinDate: i === 3 ? new Date(Date.now() - 6 * 365.25 * 86400000) : null } } } });
      users.push(user); tokens.push((await call("/auth/login", 200, undefined, "POST", { username: user.username, password })).tokens.accessToken);
    }
    const [admin, officer, sub, bomberoA, bomberoB, guard, bomberoC] = tokens;
    const [, officerUser, , aUser, bUser, , cUser] = users;

    // --- 27: agenda ---
    const start = new Date(Date.now() + 3 * 86400000), end = new Date(start.getTime() + 2 * 3600000);
    const event = { title: "Práctica de rescate", description: "Traer equipo", kind: "TRAINING", location: "Cuartel", startsAt: start.toISOString(), endsAt: end.toISOString() };
    await call("/station/events", 403, bomberoA, "POST", event);
    await call("/station/events", 400, officer, "POST", { ...event, kind: "PARTY" });
    await call("/station/events", 400, officer, "POST", { ...event, endsAt: start.toISOString() });
    const created = await call("/station/events", 201, officer, "POST", event);
    assert(await prisma.memberNotification.findFirst({ where: { userId: aUser!.id, href: "/agenda" } }), "Se avisa al personal de la nueva actividad");
    await call(`/station/events/${created.id}/rsvp`, 200, bomberoA, "POST", { response: "GOING" });
    await call(`/station/events/${created.id}/rsvp`, 200, bomberoB, "POST", { response: "NOT_GOING" });
    await call(`/station/events/${created.id}/rsvp`, 400, bomberoB, "POST", { response: "SI" });
    let list = await call("/station/events", 200, bomberoA);
    assert.equal(list[0].counts.GOING, 1); assert.equal(list[0].myResponse, "GOING"); assert.equal(list[0].attendees, undefined, "El bombero no ve quién respondió");
    list = await call("/station/events", 200, officer); assert.equal(list[0].attendees.length, 2);
    await call(`/station/events/${created.id}`, 200, officer, "PUT", { ...event, title: "Práctica de rescate vehicular", revision: 1 });
    await call(`/station/events/${created.id}`, 409, officer, "PUT", { ...event, revision: 1 });
    await call(`/station/events/${created.id}/cancel`, 403, bomberoA, "POST", { reason: "No corresponde" });
    await call(`/station/events/${created.id}/cancel`, 200, officer, "POST", { reason: "Lluvia intensa" });
    await call(`/station/events/${created.id}/rsvp`, 409, bomberoA, "POST", { response: "MAYBE" });
    for (const action of ["STATION_EVENT_CREATED", "STATION_EVENT_RSVP", "STATION_EVENT_UPDATED", "STATION_EVENT_CANCELLED"]) assert(await prisma.auditLog.findFirst({ where: { action } }), action);
    // Recordatorio unico 24 h antes.
    const soon = await prisma.stationEvent.create({ data: { title: "Reunión mensual", kind: "MEETING", startsAt: new Date(Date.now() + 3 * 3600000), endsAt: new Date(Date.now() + 4 * 3600000), createdByUserId: officerUser!.id } });
    const { remindUpcomingEvents } = await import("../modules/station/station.service");
    assert.equal(await remindUpcomingEvents(), 1); assert.equal(await remindUpcomingEvents(), 0);
    assert(await prisma.memberNotification.findFirst({ where: { userId: bUser!.id, title: "Mañana: Reunión mensual" } }));
    assert((await prisma.stationEvent.findUniqueOrThrow({ where: { id: soon.id } })).reminderSentAt);

    // --- 3: refuerzos ---
    const incident = await prisma.incident.create({ data: { title: "Incendio de prueba", type: "FIRE", description: "Prueba", location: "Calle 1", createdByUserId: officerUser!.id } });
    await call(`/station/incidents/${incident.id}/reinforcements`, 403, bomberoA, "POST", { message: "Hace falta gente" });
    const reinforcement = await call(`/station/incidents/${incident.id}/reinforcements`, 201, officer, "POST", { message: "Hace falta gente" });
    assert.equal(reinforcement.notified, 2, "Solo personal disponible: los dos bomberos confirmados");
    assert(!(await prisma.memberNotification.findFirst({ where: { userId: cUser!.id, title: { startsWith: "Se necesitan refuerzos" } } })), "Quien no está disponible no recibe el pedido");
    await call(`/station/incidents/${incident.id}/reinforcements`, 429, officer, "POST", { message: "Otra vez" });
    await call(`/station/incidents/${incident.id}/reinforcements`, 429, guard, "POST", { message: "Choferes", target: "DRIVERS" }); // misma ventana de 5 minutos
    await prisma.incident.update({ where: { id: incident.id }, data: { status: "CLOSED" } });
    await purgeAuditLogs(prisma, { action: "INCIDENT_REINFORCEMENT_REQUESTED" });
    await call(`/station/incidents/${incident.id}/reinforcements`, 409, officer, "POST", { message: "Tarde" });

    // --- 16: bolsa de reemplazos ---
    const futureDay = stationDate(new Date(Date.now() + 6 * 86400000));
    const shift = await prisma.shift.create({ data: { date: new Date(futureDay), startTime: "08:00", endTime: "20:00", shiftType: "Guardia diurna", period: "DAY", createdByUserId: officerUser!.id, assignments: { create: { userId: aUser!.id } } } });
    await call(`/shifts/${shift.id}/swap`, 403, bomberoB, "POST", { reason: "No es mi guardia, prueba" });
    const offer = await call(`/shifts/${shift.id}/swap`, 201, bomberoA, "POST", { reason: "Viaje familiar ese día" });
    assert.equal(offer.status, "OPEN"); assert.equal(offer.toUserId, null);
    await call(`/shifts/${shift.id}/swap`, 409, bomberoA, "POST", { reason: "Segundo pedido igual" });
    assert((await call("/shifts/swaps", 200, bomberoB)).some((s: { id: string }) => s.id === offer.id), "La oferta abierta la ve todo el personal");
    await call(`/shifts/swaps/${offer.id}/take`, 400, bomberoA, "POST", {});
    await call(`/shifts/swaps/${offer.id}/answer`, 403, bomberoB, "POST", { accept: true });
    await call(`/shifts/swaps/${offer.id}/take`, 200, bomberoB, "POST", {});
    await call(`/shifts/swaps/${offer.id}/take`, 409, bomberoC, "POST", {});
    await call(`/shifts/swaps/${offer.id}/decide`, 200, officer, "POST", { approve: true, note: "Cobertura aprobada" });
    const assigned = await prisma.shiftAssignment.findMany({ where: { shiftId: shift.id } });
    assert.deepEqual(assigned.map((a) => a.userId), [bUser!.id], "La guardia pasa a quien la tomó");
    for (const action of ["SHIFT_SWAP_OFFERED", "SHIFT_SWAP_TAKEN", "SHIFT_SWAP_APPROVED"]) assert(await prisma.auditLog.findFirst({ where: { action } }), action);
    const offer2 = await call(`/shifts/${shift.id}/swap`, 201, bomberoB, "POST", { reason: "Retiro la oferta luego" });
    await call(`/shifts/swaps/${offer2.id}/answer`, 200, bomberoB, "POST", { accept: false });
    assert.equal((await prisma.shiftSwapRequest.findUniqueOrThrow({ where: { id: offer2.id } })).status, "CANCELLED");

    // --- 25: mensajes por grupo ---
    await call("/chat/messages", 403, bomberoA, "POST", { body: "Para jefatura", audience: "COMMAND" });
    const toCommand = await call("/chat/messages", 201, officer, "POST", { body: "Reunión de jefatura", audience: "COMMAND" });
    await call("/chat/messages", 400, officer, "POST", { body: "x", audience: "TODOS" });
    assert(!(await call("/chat/messages", 200, bomberoA)).some((m: { id: string }) => m.id === toCommand.id), "El bombero no ve mensajes de jefatura");
    assert((await call("/chat/messages", 200, sub)).some((m: { id: string }) => m.id === toCommand.id));
    await call(`/members/messages/${toCommand.id}/read`, 403, bomberoA);
    await call(`/members/messages/${toCommand.id}/read`, 200, sub);
    const groupNote = await prisma.memberNotification.findFirstOrThrow({ where: { userId: users[2]!.id, dedupeKey: `chat:${toCommand.id}:${users[2]!.id}` } });
    assert.match(groupNote.title, /Mensaje de .* · Jefatura/); assert.equal(groupNote.body, "Reunión de jefatura");
    const general = await call("/chat/messages", 201, bomberoA, "POST", { body: "Aviso general" });
    assert.equal(general.audience, "ALL");
    // Los mensajes generales tambien llegan al celular de todo el personal (menos a quien lo escribe).
    const generalNotes = await prisma.memberNotification.findMany({ where: { dedupeKey: { startsWith: `chat:${general.id}:` } } });
    assert(generalNotes.length >= 3, "Se avisa a todo el personal");
    assert(generalNotes.every((n) => n.body === "Aviso general" && n.href === "/chat"));
    assert(!generalNotes.some((n) => n.userId === users[3]!.id), "Quien lo escribe no recibe su propio aviso");

    // --- Encuestas en comunicaciones ---
    await call("/chat/messages", 400, bomberoA, "POST", { body: "¿Una sola?", poll: { options: ["Sí"] } });
    await call("/chat/messages", 400, bomberoA, "POST", { body: "¿Repetidas?", poll: { options: ["Sí", "sí"] } });
    const single = await call("/chat/messages", 201, bomberoA, "POST", { body: "¿Qué día hacemos la práctica?", poll: { options: ["Martes", "Jueves", "Sábado"] } });
    assert.equal(single.poll.allowMultiple, false); assert.deepEqual(single.poll.options.map((o: { text: string }) => o.text), ["Martes", "Jueves", "Sábado"]);
    const [martes, jueves, sabado] = single.poll.options.map((o: { id: string }) => o.id);
    await call(`/chat/messages/${single.id}`, 409, bomberoA, "PATCH", { body: "Cambio la pregunta" });
    await call(`/chat/polls/${single.poll.id}/vote`, 400, bomberoB, "POST", { optionIds: [martes, jueves] });
    await call(`/chat/polls/${single.poll.id}/vote`, 400, bomberoB, "POST", { optionIds: ["no-existe"] });
    await call(`/chat/polls/${single.poll.id}/vote`, 403, admin, "POST", { optionIds: [martes] });
    await call(`/chat/polls/${single.poll.id}/vote`, 200, bomberoB, "POST", { optionIds: [martes] });
    let voted = await call(`/chat/polls/${single.poll.id}/vote`, 200, bomberoB, "POST", { optionIds: [jueves] }); // cambiar el voto
    assert.equal(voted.poll.options[0].votes.length, 0); assert.equal(voted.poll.options[1].votes[0].userId, bUser!.id);
    await call(`/chat/polls/${single.poll.id}/vote`, 200, bomberoC, "POST", { optionIds: [sabado] });
    voted = await call(`/chat/polls/${single.poll.id}/vote`, 200, bomberoC, "POST", { optionIds: [] }); // retirar el voto
    assert.equal(voted.poll.options[2].votes.length, 0);
    await call(`/chat/polls/${single.poll.id}/close`, 403, bomberoB, "POST");
    const closedPoll = await call(`/chat/polls/${single.poll.id}/close`, 200, bomberoA, "POST");
    assert(closedPoll.poll.closedAt);
    await call(`/chat/polls/${single.poll.id}/vote`, 409, bomberoB, "POST", { optionIds: [martes] });
    const multi = await call("/chat/messages", 201, officer, "POST", { body: "¿Qué temas repasamos?", audience: "COMMAND", poll: { options: ["Rescate", "Materiales peligrosos", "RCP"], allowMultiple: true } });
    await call(`/chat/polls/${multi.poll.id}/vote`, 403, bomberoA, "POST", { optionIds: [multi.poll.options[0].id] }); // no es de su grupo
    voted = await call(`/chat/polls/${multi.poll.id}/vote`, 200, sub, "POST", { optionIds: [multi.poll.options[0].id, multi.poll.options[2].id] });
    assert.equal(voted.poll.options.filter((o: { votes: unknown[] }) => o.votes.length === 1).length, 2);
    await call(`/chat/polls/${multi.poll.id}/close`, 200, admin, "POST"); // jefatura puede cerrar encuestas ajenas
    for (const action of ["CHAT_POLL_VOTED", "CHAT_POLL_VOTE_REMOVED", "CHAT_POLL_CLOSED"]) assert(await prisma.auditLog.findFirst({ where: { action } }), action);

    // --- 18: cumplimiento de guardias ---
    const previous = new Date(stationDate() + "T12:00:00Z"); previous.setUTCDate(1); previous.setUTCMonth(previous.getUTCMonth() - 1);
    const month = previous.toISOString().slice(0, 7), day = month + "-03";
    await prisma.shift.create({ data: { date: new Date(day), startTime: "08:00", endTime: "20:00", shiftType: "Guardia diurna", period: "DAY", createdByUserId: officerUser!.id, assignments: { create: [{ userId: aUser!.id }, { userId: bUser!.id }] } } });
    const station = await prisma.station.create({ data: { name: "Base prueba", latitude: -33, longitude: -64 } });
    const qr = await prisma.qrChallenge.create({ data: { stationId: station.id, tokenHash: randomUUID(), expiresAt: new Date() } });
    await prisma.attendance.create({ data: { userId: aUser!.id, stationId: station.id, status: "CLOSED", checkInQrId: qr.id, checkInTrust: "HIGH", checkOutTrust: "HIGH", checkInAt: new Date(day + "T07:55:00-03:00"), checkOutAt: new Date(day + "T20:05:00-03:00") } });
    await call(`/station/reports/guards?month=${month}`, 403, bomberoA);
    await call(`/station/reports/guards?month=2026-13`, 400, officer);
    const guards = await call(`/station/reports/guards?month=${month}`, 200, officer);
    assert.equal(guards.totals.attended, 1); assert.equal(guards.totals.missed, 1); assert.equal(guards.totals.rate, 50);
    assert.equal(guards.people.find((p: { userId: string }) => p.userId === bUser!.id).rate, 0);

    // --- 35: comparativa ---
    await call(`/station/reports/compare?year=2026`, 403, guard);
    const compare = await call(`/station/reports/compare?year=${new Date().getFullYear()}`, 200, sub);
    assert.equal(compare.current.months.length, 12); assert.equal(compare.previous.year, new Date().getFullYear() - 1);

    // --- 14: escalafon ---
    await call("/station/seniority", 403, bomberoA);
    const seniority = await call("/station/seniority", 200, officer);
    const a = seniority.people.find((p: { userId: string }) => p.userId === aUser!.id);
    assert.equal(a.nextRank, "Sub oficial"); assert.equal(a.eligible, false); assert(a.missing.some((m: string) => m.startsWith("Cursos")));
    assert(!seniority.people.some((p: { rank: string }) => p.rank === "Administrador"));
    const rules = seniority.rules.map((r: Record<string, unknown>) => ({ rank: r.rank, nextRank: r.nextRank, minYearsInRank: r.minYearsInRank, minYearsService: r.minYearsService, minApprovedCourses: r.rank === "Bombero" ? 0 : r.minApprovedCourses }));
    await call("/station/promotion-rules", 403, sub, "PUT", { reason: "Ajuste de prueba del escalafón", rules });
    await call("/station/promotion-rules", 200, officer, "PUT", { reason: "Ajuste de prueba del escalafón", rules });
    assert.equal((await call("/station/seniority", 200, officer)).people.find((p: { userId: string }) => p.userId === aUser!.id).eligible, true);
    assert(await prisma.auditLog.findFirst({ where: { action: "PROMOTION_RULES_UPDATED" } }));
    // El cambio de cargo registra la fecha del ascenso.
    const target = await prisma.user.findUniqueOrThrow({ where: { id: aUser!.id } });
    await call(`/users/${aUser!.id}`, 200, admin, "PATCH", { rank: "Sub oficial", revision: target.updatedAt.toISOString() });
    assert((await prisma.firefighterProfile.findUniqueOrThrow({ where: { userId: aUser!.id } })).rankSince, "Se guarda la fecha del ascenso");

    // --- 30: biblioteca ---
    const doc = await prisma.operationalDocument.create({ data: { kind: "PROTOCOL", status: "PUBLISHED", title: "Uso de ERA", category: "Operativo", body: "Texto", createdByUserId: officerUser!.id, publishedAt: new Date() } });
    const draft = await prisma.operationalDocument.create({ data: { kind: "PROTOCOL", status: "DRAFT", title: "Borrador", category: "Operativo", body: "Texto", createdByUserId: officerUser!.id } });
    await call(`/station/documents/${draft.id}/read`, 404, bomberoB, "POST", {});
    await call(`/station/documents/${doc.id}/read`, 200, bomberoB, "POST", {});
    await call(`/station/documents/${doc.id}/read`, 200, bomberoB, "POST", {});
    assert.equal(await prisma.documentRead.count({ where: { documentId: doc.id } }), 1, "Leer dos veces la misma versión no duplica");
    assert.equal((await call("/station/documents/reads/mine", 200, bomberoB)).length, 1);
    await call(`/station/documents/${doc.id}/reads`, 403, bomberoB);
    const report = await call(`/station/documents/${doc.id}/reads`, 200, sub);
    assert.equal(report.read.length, 1); assert(report.pending.some((p: { userId: string }) => p.userId === bUser!.id) === false);
    await prisma.operationalDocument.update({ where: { id: doc.id }, data: { revision: 2 } });
    assert.equal((await call(`/station/documents/${doc.id}/reads`, 200, sub)).read.length, 0, "Una versión nueva pide leer de nuevo");

    // --- 5 y 2: direcciones frecuentes y tablero ---
    await prisma.alert.create({ data: { type: "FIRE", priority: "HIGH", location: "San Martín 450", description: "Prueba", createdByUserId: officerUser!.id } });
    await prisma.alert.create({ data: { type: "FIRE", priority: "LOW", location: "san martín  450", description: "Prueba", createdByUserId: officerUser!.id } });
    await call("/station/locations", 403, bomberoC);
    const locations = await call("/station/locations", 200, guard);
    assert.equal(locations[0].uses, 2, "Las direcciones se agrupan sin importar mayúsculas ni espacios");
    await call("/station/board", 403, bomberoC);
    assert(Array.isArray((await call("/station/board", 200, guard)).incidents));

    // --- 62: instituciones en la intervencion ---
    const joint = await prisma.incident.create({ data: { title: "Choque en ruta", type: "ACCIDENT", description: "Prueba", location: "Ruta 8 km 612", occurredAt: new Date(Date.now() - 3600000), createdByUserId: officerUser!.id } });
    const agency = { agencyType: "POLICE", name: "Comisaría Sampacho", unit: "Patrullero 214", inCharge: "Cabo Pérez", phone: "0358 400000", arrivedAt: new Date(Date.now() - 1800000).toISOString(), notes: "Corte de tránsito" };
    await call(`/incidents/${joint.id}/agencies`, 403, bomberoB, "POST", agency);
    await call(`/incidents/${joint.id}/agencies`, 400, officer, "POST", { ...agency, arrivedAt: new Date(Date.now() + 3600000).toISOString() });
    await call(`/incidents/${joint.id}/agencies`, 400, officer, "POST", { ...agency, leftAt: new Date(Date.now() - 2400000).toISOString() });
    await call(`/incidents/${joint.id}/agencies`, 400, officer, "POST", { ...agency, agencyType: "ARMY" });
    const added = await call(`/incidents/${joint.id}/agencies`, 201, officer, "POST", agency);
    await call(`/incidents/${joint.id}/agencies`, 409, officer, "POST", { ...agency, name: "comisaría sampacho", unit: "patrullero 214" });
    const listed = await call(`/incidents/${joint.id}/agencies`, 200, bomberoB);
    assert.equal(listed.canEdit, false); assert.equal(listed.items.length, 1);
    assert((await call("/station/board", 200, guard)).incidents.find((i: { id: string }) => i.id === joint.id).agencies.length === 1, "El tablero muestra quién sigue en el lugar");
    await call(`/incidents/${joint.id}/agencies/${added.id}`, 200, officer, "PUT", { ...agency, leftAt: new Date().toISOString(), revision: 1 });
    await call(`/incidents/${joint.id}/agencies/${added.id}`, 409, officer, "PUT", { ...agency, revision: 1 });
    await call(`/incidents/${joint.id}/agencies/${added.id}/void`, 400, officer, "POST", { reason: "corto" });
    await call(`/incidents/${joint.id}/agencies/${added.id}/void`, 200, officer, "POST", { reason: "Cargada en la intervención equivocada" });
    await call(`/incidents/${joint.id}/agencies/${added.id}/void`, 409, officer, "POST", { reason: "Cargada en la intervención equivocada" });
    assert.equal(await prisma.incidentAgency.count({ where: { id: added.id } }), 1, "Anular no borra");
    for (const action of ["INCIDENT_AGENCY_ADDED", "INCIDENT_AGENCY_UPDATED", "INCIDENT_AGENCY_VOIDED"]) assert(await prisma.auditLog.findFirst({ where: { action, entityId: joint.id } }), action);
    await call(`/incidents/${joint.id}/agencies`, 201, officer, "POST", { ...agency, unit: "Patrullero 300" });
    assert.equal((await call(`/station/reports/compare?year=${new Date().getFullYear()}`, 200, officer)).current.agencies.POLICE, 1);

    // Estado de la base: publico, sin datos personales, y detecta migraciones pendientes.
    const { checkMigrations } = await import("../utils/migration-check");
    assert.deepEqual((await checkMigrations()).pending, [], "El esquema de prueba tiene todas las migraciones");
    const health = await call("/health", 200);
    assert.equal(health.status, "ok"); assert.equal(health.database, "actualizada");

    console.log(`Cuartel: ${paths} caminos HTTP aprobados; agenda, refuerzos, bolsa de reemplazos, mensajes por grupo, guardias, comparativa, escalafón, biblioteca y tablero.`);
  } finally {
    if (server) await new Promise<void>((r) => server!.close(() => r()));
    if (db) { const { flushRequestAudit } = await import("../middlewares/request-audit.middleware"); await flushRequestAudit(); }
    await db?.$disconnect(); process.env.DATABASE_URL = original;
    if (!/^station_verify_[a-f0-9]{16}$/.test(schema)) throw Error("Esquema inválido");
    await root.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await root.$disconnect();
  }
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
