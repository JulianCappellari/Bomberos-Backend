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
const ranking_rules_1 = require("../modules/ranking/ranking.rules");
const station_time_1 = require("../utils/station-time");
async function main() {
    if (process.env.NODE_ENV === "production")
        throw Error("No se prueba en producción");
    const original = process.env.DATABASE_URL, schema = "ranking_verify_" + (0, node_crypto_1.randomBytes)(8).toString("hex"), url = new URL(original);
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
        await new Promise(r => server.once("listening", r));
        const address = server.address();
        (0, strict_1.default)(address && typeof address !== "string");
        const base = `http://127.0.0.1:${address.port}/api`;
        let paths = 0;
        async function call(path, status, token, method = "GET", body) { const response = await fetch(base + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }); const data = await response.json(); strict_1.default.equal(response.status, status, `${path}: ${JSON.stringify(data)}`); paths++; return data; }
        const password = (0, node_crypto_1.randomUUID)() + "!Aa7", passwordHash = await bcrypt_1.default.hash(password, 10), users = [], tokens = [];
        for (const [i, rank] of ["Administrador", "Sub oficial", "Bombero", "Guardia", "Bombero", "Oficial"].entries()) {
            const user = await prisma.user.create({ data: { username: "ranking_test_" + i, role: i === 0 ? "ADMIN" : "FIREFIGHTER", passwordHash, profile: { create: { rank, fullName: "Prueba ranking " + i, dni: "RANK-" + i, badge: "RANK-" + i } } } });
            users.push(user);
            tokens.push((await call("/auth/login", 200, undefined, "POST", { username: user.username, password })).tokens.accessToken);
        }
        const [admin, sub, staff, guard] = tokens;
        for (const token of [sub, staff, guard]) {
            await call("/ranking", 403, token);
            await call("/ranking/templates", 403, token);
            await call("/ranking/policy", 403, token, "PUT", {});
            await call("/ranking/recovery", 403, token, "POST", {});
        }
        await call("/ranking", 200, tokens[5]);
        await call("/ranking", 401);
        await call("/ranking?month=invalid", 400, admin);
        const monthDate = new Date((0, station_time_1.stationDate)() + "T12:00:00Z");
        monthDate.setUTCDate(1);
        monthDate.setUTCMonth(monthDate.getUTCMonth() - 1);
        const month = monthDate.toISOString().slice(0, 7), day = month + "-02";
        const station = await prisma.station.create({ data: { name: "Base prueba ranking", latitude: -33, longitude: -64 } });
        const qr = await prisma.qrChallenge.create({ data: { stationId: station.id, tokenHash: (0, node_crypto_1.randomUUID)(), expiresAt: new Date() } });
        for (const userId of [users[2].id, users[3].id])
            for (let i = 0; i < 2; i++)
                await prisma.attendance.create({ data: { userId, stationId: station.id, status: "CLOSED", checkInQrId: qr.id, checkInTrust: "HIGH", checkOutTrust: "HIGH", checkInAt: new Date(day + "T06:00:00-03:00"), checkOutAt: new Date(day + "T16:00:00-03:00") } });
        await prisma.shift.create({ data: { date: new Date(day), startTime: "08:00", endTime: "20:00", shiftType: "Guardia pagada", period: "DAY", createdByUserId: users[0].id, assignments: { create: { userId: users[2].id } } } });
        await prisma.workTask.create({ data: { title: "Trabajo verificado", description: "Actividad real validada en prueba", createdByUserId: users[0].id, status: "VERIFIED", officerApproved: true, createdAt: new Date(month + "-01T12:00:00-03:00"), completionNotes: "Trabajo realizado con evidencia de prueba", reviewNotes: "Verificado de forma independiente", completedAt: new Date(day + "T07:00:00-03:00"), reviewedAt: new Date(day + "T08:00:00-03:00"), reviewedByUserId: users[1].id, members: { create: { userId: users[2].id } } } });
        await prisma.workTask.create({ data: { title: "Trabajo incumplido", description: "Actividad asignada vencida en prueba", createdAt: new Date(month + "-01T12:00:00-03:00"), createdByUserId: users[0].id, dueOn: new Date(day), members: { create: { userId: users[2].id } } } });
        const board = await call("/ranking?month=" + month, 200, admin);
        (0, strict_1.default)(!board.rows.some((r) => r.userId === users[0].id));
        const row = board.rows.find((r) => r.userId === users[2].id);
        strict_1.default.equal(row.minutes, 120);
        strict_1.default.equal(row.breakdown.hours, 4);
        strict_1.default.equal(row.breakdown.tasks, 10);
        strict_1.default.equal(row.breakdown.penalties, 5);
        strict_1.default.equal(row.points, 9);
        strict_1.default.deepEqual(row.counters, { voluntaryMinutes: 120, tasks: 1, inspections: 0, incidents: 0, courses: 0, missedTasks: 1, declinedTasks: 0 });
        strict_1.default.equal(board.rows.find((r) => r.userId === users[3].id).minutes, 0);
        strict_1.default.deepEqual((await call("/ranking?month=" + month, 200, admin)).rows, board.rows);
        const policy = { revision: 0, config: ranking_rules_1.defaults, reason: "Reglas de puntaje aprobadas para prueba" };
        await call("/ranking/policy", 403, staff, "PUT", policy);
        await call("/ranking/policy", 200, admin, "PUT", policy);
        await call("/ranking/policy", 409, admin, "PUT", policy);
        strict_1.default.equal(await prisma.rankingTemplate.count({ where: { active: true } }), 3);
        await prisma.rankingTemplate.updateMany({ data: { active: false } });
        const recovery = { month: (0, station_time_1.stationDate)().slice(0, 7), policyRevision: 1 };
        await call("/ranking/recovery", 403, guard, "POST", recovery);
        await call("/ranking/recovery", 409, admin, "POST", recovery);
        const template = { title: "Ordenar salón común", description: "Ordenar las mesas sin manipular equipos operativos.", active: true };
        await call("/ranking/templates", 403, staff, "POST", template);
        const t = await call("/ranking/templates", 201, admin, "POST", template);
        const result = await call("/ranking/recovery", 201, admin, "POST", recovery);
        (0, strict_1.default)(result.created.some((r) => r.userId === users[4].id));
        (0, strict_1.default)(!result.created.some((r) => r.userId === users[2].id));
        strict_1.default.equal((await call("/ranking/recovery", 201, admin, "POST", recovery)).created.length, 0);
        const taskList = await call("/work/tasks", 200, tokens[4]);
        (0, strict_1.default)(!JSON.stringify(taskList).includes("rankingRecoveryKey"));
        const assigned = result.created.find((r) => r.userId === users[4].id);
        await call("/work/tasks/" + assigned.taskId + "/member", 200, tokens[4], "POST", { revision: 1, action: "TRANSFER", targetUserId: users[1].id, notes: "Solicitud de reasignación que debe revisar jefatura" });
        (0, strict_1.default)(await prisma.workTaskMember.findUnique({ where: { taskId_userId: { taskId: assigned.taskId, userId: users[4].id } } }));
        strict_1.default.equal(await prisma.workTaskMember.findUnique({ where: { taskId_userId: { taskId: assigned.taskId, userId: users[1].id } } }), null);
        await call("/work/tasks/" + assigned.taskId + "/member", 200, tokens[4], "POST", { revision: 2, action: "DECLINE", notes: "Imposibilidad que no debe eximir automáticamente" });
        const due = new Date(Date.now() - 86400000);
        await prisma.workTask.update({ where: { id: assigned.taskId }, data: { createdAt: new Date(Date.now() - 3 * 86400000), dueOn: new Date((0, station_time_1.stationDate)(due)) } });
        const penalties = await call("/ranking?month=" + (0, station_time_1.stationDate)(due).slice(0, 7), 200, admin);
        (0, strict_1.default)(penalties.rows.find((r) => r.userId === users[4].id).breakdown.penalties >= ranking_rules_1.defaults.missedTask);
        await prisma.workTaskMember.update({ where: { taskId_userId: { taskId: assigned.taskId, userId: users[4].id } }, data: { declinedAt: null } });
        const reclaimed = await call("/ranking?month=" + (0, station_time_1.stationDate)().slice(0, 7), 200, admin);
        strict_1.default.equal(reclaimed.rows.find((r) => r.userId === users[4].id).counters.declinedTasks, 1, "Volver a tomar una tarea no borra el descuento historico de No puedo");
        const history = await call("/work/tasks/" + assigned.taskId + "/history", 200, tokens[4]);
        (0, strict_1.default)(!JSON.stringify(history).includes("puntaje"));
        await call("/ranking/templates/" + t.id, 200, admin, "PUT", { ...template, revision: 1, active: false });
        await call("/ranking/templates/" + t.id, 409, admin, "PUT", { ...template, revision: 1 });
        strict_1.default.equal(await prisma.auditLog.count({ where: { action: "RANKING_RECOVERY_ASSIGNED" } }), result.created.length);
        console.log(`Ranking: ${paths} caminos HTTP aprobados; horas pagadas excluidas, intervalos sin duplicar, puntos y penalizaciones, permisos y sorteo idempotente.`);
    }
    finally {
        if (server)
            await new Promise(r => server.close(() => r()));
        if (db) {
            const { flushRequestAudit } = await Promise.resolve().then(() => __importStar(require("../middlewares/request-audit.middleware")));
            await flushRequestAudit();
        }
        await db?.$disconnect();
        process.env.DATABASE_URL = original;
        if (!/^ranking_verify_[a-f0-9]{16}$/.test(schema))
            throw Error("Esquema inválido");
        await root.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await root.$disconnect();
    }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
