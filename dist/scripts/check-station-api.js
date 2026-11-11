"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const strict_1 = __importDefault(require("node:assert/strict"));
const node_crypto_1 = require("node:crypto");
const node_child_process_1 = require("node:child_process");
const client_1 = require("@prisma/client");
const bcrypt_1 = __importDefault(require("bcrypt"));
const station_time_1 = require("../utils/station-time");
// Funciones del cuartel: agenda, refuerzos, bolsa de reemplazos, mensajes por grupo, reportes,
// escalafon, biblioteca, direcciones frecuentes y tablero. Corre en un esquema aislado.
async function main() {
    if (process.env.NODE_ENV === "production")
        throw Error("No se prueba en producción");
    const original = process.env.DATABASE_URL, schema = "station_verify_" + (0, node_crypto_1.randomBytes)(8).toString("hex"), url = new URL(original);
    url.searchParams.set("schema", schema);
    const root = new client_1.PrismaClient({ datasourceUrl: original });
    let db, server;
    try {
        (0, node_child_process_1.execFileSync)(process.execPath, [require.resolve("prisma/build/index.js"), "migrate", "deploy"], { env: { ...process.env, DATABASE_URL: url.toString() }, stdio: "pipe" });
        process.env.DATABASE_URL = url.toString();
        const { prisma } = await Promise.resolve().then(() => __importStar(require("../config/prisma")));
        db = prisma;
        const { app } = await Promise.resolve().then(() => __importStar(require("../app")));
        server = app.listen(0, "127.0.0.1");
        await new Promise((r) => server.once("listening", r));
        const address = server.address();
        (0, strict_1.default)(address && typeof address !== "string");
        const base = `http://127.0.0.1:${address.port}/api`;
        let paths = 0;
        async function call(path, status, token, method = "GET", body) {
            const response = await fetch(base + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
            const data = await response.json();
            strict_1.default.equal(response.status, status, `${method} ${path}: ${JSON.stringify(data)}`);
            paths++;
            return data;
        }
        const password = (0, node_crypto_1.randomUUID)() + "!Aa7", passwordHash = await bcrypt_1.default.hash(password, 10);
        const ranks = ["Administrador", "Oficial", "Sub oficial", "Bombero", "Bombero", "Guardia", "Bombero"];
        const users = [], tokens = [];
        for (const [i, rank] of ranks.entries()) {
            const user = await prisma.user.create({ data: { username: "station_test_" + i, role: i === 0 ? "ADMIN" : "FIREFIGHTER", passwordHash, emergencyStatusConfirmedAt: [3, 4].includes(i) ? new Date() : null, profile: { create: { rank, fullName: "Prueba cuartel " + i, dni: "ST-" + i, badge: "ST-" + i, joinDate: i === 3 ? new Date(Date.now() - 6 * 365.25 * 86400000) : null } } } });
            users.push(user);
            tokens.push((await call("/auth/login", 200, undefined, "POST", { username: user.username, password })).tokens.accessToken);
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
        (0, strict_1.default)(await prisma.memberNotification.findFirst({ where: { userId: aUser.id, href: "/agenda" } }), "Se avisa al personal de la nueva actividad");
        await call(`/station/events/${created.id}/rsvp`, 200, bomberoA, "POST", { response: "GOING" });
        await call(`/station/events/${created.id}/rsvp`, 200, bomberoB, "POST", { response: "NOT_GOING" });
        await call(`/station/events/${created.id}/rsvp`, 400, bomberoB, "POST", { response: "SI" });
        let list = await call("/station/events", 200, bomberoA);
        strict_1.default.equal(list[0].counts.GOING, 1);
        strict_1.default.equal(list[0].myResponse, "GOING");
        strict_1.default.equal(list[0].attendees, undefined, "El bombero no ve quién respondió");
        list = await call("/station/events", 200, officer);
        strict_1.default.equal(list[0].attendees.length, 2);
        await call(`/station/events/${created.id}`, 200, officer, "PUT", { ...event, title: "Práctica de rescate vehicular", revision: 1 });
        await call(`/station/events/${created.id}`, 409, officer, "PUT", { ...event, revision: 1 });
        await call(`/station/events/${created.id}/cancel`, 403, bomberoA, "POST", { reason: "No corresponde" });
        await call(`/station/events/${created.id}/cancel`, 200, officer, "POST", { reason: "Lluvia intensa" });
        await call(`/station/events/${created.id}/rsvp`, 409, bomberoA, "POST", { response: "MAYBE" });
        for (const action of ["STATION_EVENT_CREATED", "STATION_EVENT_RSVP", "STATION_EVENT_UPDATED", "STATION_EVENT_CANCELLED"])
            (0, strict_1.default)(await prisma.auditLog.findFirst({ where: { action } }), action);
        // Recordatorio unico 24 h antes.
        const soon = await prisma.stationEvent.create({ data: { title: "Reunión mensual", kind: "MEETING", startsAt: new Date(Date.now() + 3 * 3600000), endsAt: new Date(Date.now() + 4 * 3600000), createdByUserId: officerUser.id } });
        const { remindUpcomingEvents } = await Promise.resolve().then(() => __importStar(require("../modules/station/station.service")));
        strict_1.default.equal(await remindUpcomingEvents(), 1);
        strict_1.default.equal(await remindUpcomingEvents(), 0);
        (0, strict_1.default)(await prisma.memberNotification.findFirst({ where: { userId: bUser.id, title: "Mañana: Reunión mensual" } }));
        (0, strict_1.default)((await prisma.stationEvent.findUniqueOrThrow({ where: { id: soon.id } })).reminderSentAt);
        // --- 3: refuerzos ---
        const incident = await prisma.incident.create({ data: { title: "Incendio de prueba", type: "FIRE", description: "Prueba", location: "Calle 1", createdByUserId: officerUser.id } });
        await call(`/station/incidents/${incident.id}/reinforcements`, 403, bomberoA, "POST", { message: "Hace falta gente" });
        const reinforcement = await call(`/station/incidents/${incident.id}/reinforcements`, 201, officer, "POST", { message: "Hace falta gente" });
        strict_1.default.equal(reinforcement.notified, 2, "Solo personal disponible: los dos bomberos confirmados");
        (0, strict_1.default)(!(await prisma.memberNotification.findFirst({ where: { userId: cUser.id, title: { startsWith: "Se necesitan refuerzos" } } })), "Quien no está disponible no recibe el pedido");
        await call(`/station/incidents/${incident.id}/reinforcements`, 429, officer, "POST", { message: "Otra vez" });
        await call(`/station/incidents/${incident.id}/reinforcements`, 429, guard, "POST", { message: "Choferes", target: "DRIVERS" }); // misma ventana de 5 minutos
        await prisma.incident.update({ where: { id: incident.id }, data: { status: "CLOSED" } });
        await prisma.auditLog.deleteMany({ where: { action: "INCIDENT_REINFORCEMENT_REQUESTED" } });
        await call(`/station/incidents/${incident.id}/reinforcements`, 409, officer, "POST", { message: "Tarde" });
        // --- 16: bolsa de reemplazos ---
        const futureDay = (0, station_time_1.stationDate)(new Date(Date.now() + 6 * 86400000));
        const shift = await prisma.shift.create({ data: { date: new Date(futureDay), startTime: "08:00", endTime: "20:00", shiftType: "Guardia diurna", period: "DAY", createdByUserId: officerUser.id, assignments: { create: { userId: aUser.id } } } });
        await call(`/shifts/${shift.id}/swap`, 403, bomberoB, "POST", { reason: "No es mi guardia, prueba" });
        const offer = await call(`/shifts/${shift.id}/swap`, 201, bomberoA, "POST", { reason: "Viaje familiar ese día" });
        strict_1.default.equal(offer.status, "OPEN");
        strict_1.default.equal(offer.toUserId, null);
        await call(`/shifts/${shift.id}/swap`, 409, bomberoA, "POST", { reason: "Segundo pedido igual" });
        (0, strict_1.default)((await call("/shifts/swaps", 200, bomberoB)).some((s) => s.id === offer.id), "La oferta abierta la ve todo el personal");
        await call(`/shifts/swaps/${offer.id}/take`, 400, bomberoA, "POST", {});
        await call(`/shifts/swaps/${offer.id}/answer`, 403, bomberoB, "POST", { accept: true });
        await call(`/shifts/swaps/${offer.id}/take`, 200, bomberoB, "POST", {});
        await call(`/shifts/swaps/${offer.id}/take`, 409, bomberoC, "POST", {});
        await call(`/shifts/swaps/${offer.id}/decide`, 200, officer, "POST", { approve: true, note: "Cobertura aprobada" });
        const assigned = await prisma.shiftAssignment.findMany({ where: { shiftId: shift.id } });
        strict_1.default.deepEqual(assigned.map((a) => a.userId), [bUser.id], "La guardia pasa a quien la tomó");
        for (const action of ["SHIFT_SWAP_OFFERED", "SHIFT_SWAP_TAKEN", "SHIFT_SWAP_APPROVED"])
            (0, strict_1.default)(await prisma.auditLog.findFirst({ where: { action } }), action);
        const offer2 = await call(`/shifts/${shift.id}/swap`, 201, bomberoB, "POST", { reason: "Retiro la oferta luego" });
        await call(`/shifts/swaps/${offer2.id}/answer`, 200, bomberoB, "POST", { accept: false });
        strict_1.default.equal((await prisma.shiftSwapRequest.findUniqueOrThrow({ where: { id: offer2.id } })).status, "CANCELLED");
        // --- 25: mensajes por grupo ---
        await call("/chat/messages", 403, bomberoA, "POST", { body: "Para jefatura", audience: "COMMAND" });
        const toCommand = await call("/chat/messages", 201, officer, "POST", { body: "Reunión de jefatura", audience: "COMMAND" });
        await call("/chat/messages", 400, officer, "POST", { body: "x", audience: "TODOS" });
        (0, strict_1.default)(!(await call("/chat/messages", 200, bomberoA)).some((m) => m.id === toCommand.id), "El bombero no ve mensajes de jefatura");
        (0, strict_1.default)((await call("/chat/messages", 200, sub)).some((m) => m.id === toCommand.id));
        await call(`/members/messages/${toCommand.id}/read`, 403, bomberoA);
        await call(`/members/messages/${toCommand.id}/read`, 200, sub);
        (0, strict_1.default)(await prisma.memberNotification.findFirst({ where: { userId: users[2].id, title: "Nuevo mensaje para tu grupo" } }));
        const general = await call("/chat/messages", 201, bomberoA, "POST", { body: "Aviso general" });
        strict_1.default.equal(general.audience, "ALL");
        // --- 18: cumplimiento de guardias ---
        const previous = new Date((0, station_time_1.stationDate)() + "T12:00:00Z");
        previous.setUTCDate(1);
        previous.setUTCMonth(previous.getUTCMonth() - 1);
        const month = previous.toISOString().slice(0, 7), day = month + "-03";
        await prisma.shift.create({ data: { date: new Date(day), startTime: "08:00", endTime: "20:00", shiftType: "Guardia diurna", period: "DAY", createdByUserId: officerUser.id, assignments: { create: [{ userId: aUser.id }, { userId: bUser.id }] } } });
        const station = await prisma.station.create({ data: { name: "Base prueba", latitude: -33, longitude: -64 } });
        const qr = await prisma.qrChallenge.create({ data: { stationId: station.id, tokenHash: (0, node_crypto_1.randomUUID)(), expiresAt: new Date() } });
        await prisma.attendance.create({ data: { userId: aUser.id, stationId: station.id, status: "CLOSED", checkInQrId: qr.id, checkInTrust: "HIGH", checkOutTrust: "HIGH", checkInAt: new Date(day + "T07:55:00-03:00"), checkOutAt: new Date(day + "T20:05:00-03:00") } });
        await call(`/station/reports/guards?month=${month}`, 403, bomberoA);
        await call(`/station/reports/guards?month=2026-13`, 400, officer);
        const guards = await call(`/station/reports/guards?month=${month}`, 200, officer);
        strict_1.default.equal(guards.totals.attended, 1);
        strict_1.default.equal(guards.totals.missed, 1);
        strict_1.default.equal(guards.totals.rate, 50);
        strict_1.default.equal(guards.people.find((p) => p.userId === bUser.id).rate, 0);
        // --- 35: comparativa ---
        await call(`/station/reports/compare?year=2026`, 403, guard);
        const compare = await call(`/station/reports/compare?year=${new Date().getFullYear()}`, 200, sub);
        strict_1.default.equal(compare.current.months.length, 12);
        strict_1.default.equal(compare.previous.year, new Date().getFullYear() - 1);
        // --- 14: escalafon ---
        await call("/station/seniority", 403, bomberoA);
        const seniority = await call("/station/seniority", 200, officer);
        const a = seniority.people.find((p) => p.userId === aUser.id);
        strict_1.default.equal(a.nextRank, "Sub oficial");
        strict_1.default.equal(a.eligible, false);
        (0, strict_1.default)(a.missing.some((m) => m.startsWith("Cursos")));
        (0, strict_1.default)(!seniority.people.some((p) => p.rank === "Administrador"));
        const rules = seniority.rules.map((r) => ({ rank: r.rank, nextRank: r.nextRank, minYearsInRank: r.minYearsInRank, minYearsService: r.minYearsService, minApprovedCourses: r.rank === "Bombero" ? 0 : r.minApprovedCourses }));
        await call("/station/promotion-rules", 403, sub, "PUT", { reason: "Ajuste de prueba del escalafón", rules });
        await call("/station/promotion-rules", 200, officer, "PUT", { reason: "Ajuste de prueba del escalafón", rules });
        strict_1.default.equal((await call("/station/seniority", 200, officer)).people.find((p) => p.userId === aUser.id).eligible, true);
        (0, strict_1.default)(await prisma.auditLog.findFirst({ where: { action: "PROMOTION_RULES_UPDATED" } }));
        // El cambio de cargo registra la fecha del ascenso.
        const target = await prisma.user.findUniqueOrThrow({ where: { id: aUser.id } });
        await call(`/users/${aUser.id}`, 200, admin, "PATCH", { rank: "Sub oficial", revision: target.updatedAt.toISOString() });
        (0, strict_1.default)((await prisma.firefighterProfile.findUniqueOrThrow({ where: { userId: aUser.id } })).rankSince, "Se guarda la fecha del ascenso");
        // --- 30: biblioteca ---
        const doc = await prisma.operationalDocument.create({ data: { kind: "PROTOCOL", status: "PUBLISHED", title: "Uso de ERA", category: "Operativo", body: "Texto", createdByUserId: officerUser.id, publishedAt: new Date() } });
        const draft = await prisma.operationalDocument.create({ data: { kind: "PROTOCOL", status: "DRAFT", title: "Borrador", category: "Operativo", body: "Texto", createdByUserId: officerUser.id } });
        await call(`/station/documents/${draft.id}/read`, 404, bomberoB, "POST", {});
        await call(`/station/documents/${doc.id}/read`, 200, bomberoB, "POST", {});
        await call(`/station/documents/${doc.id}/read`, 200, bomberoB, "POST", {});
        strict_1.default.equal(await prisma.documentRead.count({ where: { documentId: doc.id } }), 1, "Leer dos veces la misma versión no duplica");
        strict_1.default.equal((await call("/station/documents/reads/mine", 200, bomberoB)).length, 1);
        await call(`/station/documents/${doc.id}/reads`, 403, bomberoB);
        const report = await call(`/station/documents/${doc.id}/reads`, 200, sub);
        strict_1.default.equal(report.read.length, 1);
        (0, strict_1.default)(report.pending.some((p) => p.userId === bUser.id) === false);
        await prisma.operationalDocument.update({ where: { id: doc.id }, data: { revision: 2 } });
        strict_1.default.equal((await call(`/station/documents/${doc.id}/reads`, 200, sub)).read.length, 0, "Una versión nueva pide leer de nuevo");
        // --- 5 y 2: direcciones frecuentes y tablero ---
        await prisma.alert.create({ data: { type: "FIRE", priority: "HIGH", location: "San Martín 450", description: "Prueba", createdByUserId: officerUser.id } });
        await prisma.alert.create({ data: { type: "FIRE", priority: "LOW", location: "san martín  450", description: "Prueba", createdByUserId: officerUser.id } });
        await call("/station/locations", 403, bomberoC);
        const locations = await call("/station/locations", 200, guard);
        strict_1.default.equal(locations[0].uses, 2, "Las direcciones se agrupan sin importar mayúsculas ni espacios");
        await call("/station/board", 403, bomberoC);
        (0, strict_1.default)(Array.isArray((await call("/station/board", 200, guard)).incidents));
        console.log(`Cuartel: ${paths} caminos HTTP aprobados; agenda, refuerzos, bolsa de reemplazos, mensajes por grupo, guardias, comparativa, escalafón, biblioteca y tablero.`);
    }
    finally {
        if (server)
            await new Promise((r) => server.close(() => r()));
        if (db) {
            const { flushRequestAudit } = await Promise.resolve().then(() => __importStar(require("../middlewares/request-audit.middleware")));
            await flushRequestAudit();
        }
        await db?.$disconnect();
        process.env.DATABASE_URL = original;
        if (!/^station_verify_[a-f0-9]{16}$/.test(schema))
            throw Error("Esquema inválido");
        await root.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await root.$disconnect();
    }
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
