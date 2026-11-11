import "dotenv/config";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";
import { stationDate } from "../utils/station-time";

// Seguridad anti-fraude y estadisticas de horas, en un esquema aislado.
async function main() {
  if (process.env.NODE_ENV === "production") throw Error("No se prueba en producción");
  const original = process.env.DATABASE_URL!, schema = "hardening_verify_" + randomBytes(8).toString("hex"), url = new URL(original);
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
    async function raw(path: string, token?: string, method = "GET", body?: unknown, headers: Record<string, string> = {}) {
      return fetch(base + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
    }
    async function call(path: string, status: number, token?: string, method = "GET", body?: unknown) {
      const response = await raw(path, token, method, body); const data = await response.json();
      assert.equal(response.status, status, `${method} ${path}: ${JSON.stringify(data)}`); paths++; return data;
    }
    // El limite por IP del login (10 por minuto) es real: se espera y se reintenta.
    async function login(username: string, password: string, status: number, ua = "Mozilla/5.0 (Windows NT 10.0) Chrome/130.0") {
      for (;;) {
        const response = await raw("/auth/login", undefined, "POST", { username, password }, { "User-Agent": ua });
        if (response.status === 429) { const wait = Number(response.headers.get("retry-after") || 60); console.log(`Esperando ${wait}s por el límite de intentos por IP.`); await new Promise((r) => setTimeout(r, wait * 1000 + 200)); continue; }
        const data = await response.json(); assert.equal(response.status, status, `login ${username}: ${JSON.stringify(data)}`); paths++; return data;
      }
    }
    const password = randomUUID() + "!Aa7", passwordHash = await bcrypt.hash(password, 10);
    const ranks = ["Administrador", "Oficial", "Bombero", "Bombero"];
    const users: Array<{ id: string; username: string }> = [];
    for (const [i, rank] of ranks.entries()) users.push(await prisma.user.create({ data: { username: "hard_test_" + i, role: i === 0 ? "ADMIN" : "FIREFIGHTER", passwordHash, profile: { create: { rank, fullName: "Prueba seguridad " + i, dni: "HD-" + i, badge: "HD-" + i } } } }));
    const admin = (await login(users[0]!.username, password, 200)).tokens.accessToken;
    const officer = (await login(users[1]!.username, password, 200)).tokens.accessToken;
    const firefighter = (await login(users[2]!.username, password, 200)).tokens.accessToken;
    const target = users[3]!;

    // --- Bloqueo de cuenta ---
    for (let i = 0; i < 5; i++) await login(target.username, "incorrecta-" + i, 401);
    const locked = await prisma.user.findUniqueOrThrow({ where: { id: target.id } });
    assert(locked.lockedUntil && locked.lockedUntil > new Date(), "Tras 5 fallos la cuenta queda bloqueada");
    const lockedMessage = await login(target.username, password, 401);
    assert.match(lockedMessage.message, /incorrectos/, "El mensaje no revela que la cuenta existe ni que está bloqueada");
    assert(await prisma.auditLog.findFirst({ where: { action: "AUTH_ACCOUNT_LOCKED", entityId: target.id } }));
    assert(await prisma.auditLog.findFirst({ where: { action: "AUTH_LOGIN_WHILE_LOCKED", entityId: target.id } }));
    assert(await prisma.memberNotification.findFirst({ where: { userId: target.id, title: "Tu cuenta se bloqueó por intentos fallidos" } }));
    assert(await prisma.memberNotification.findFirst({ where: { userId: users[0]!.id, title: "Cuenta bloqueada por intentos fallidos" } }), "Se avisa a administración");
    await login("no_existe_" + randomUUID().slice(0, 8), "x", 401);
    assert.equal(await prisma.auditLog.count({ where: { action: "AUTH_LOGIN_FAILED", entityId: { notIn: [target.id] } } }), 0, "Un usuario inexistente no genera registros por cuenta");

    // --- Centro de seguridad ---
    await call("/security/overview", 403, firefighter);
    await call("/security/overview", 200, officer); // el oficial cumple funciones de administrador
    const overview = await call("/security/overview", 200, admin);
    assert.equal(overview.protection.auditAppendOnly, true);
    assert(overview.lockedAccounts.some((u: { userId: string }) => u.userId === target.id));
    assert(overview.events.some((e: { action: string; target: string }) => e.action === "AUTH_ACCOUNT_LOCKED" && e.target === "Prueba seguridad 3"));
    await call(`/security/users/${target.id}/unlock`, 403, firefighter, "POST", {});
    await call(`/security/users/${target.id}/unlock`, 200, admin, "POST", {});
    const unlocked = await login(target.username, password, 200);
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: target.id } })).failedLoginCount, 0);

    // --- Dispositivo nuevo ---
    await login(target.username, password, 200);
    assert.equal(await prisma.auditLog.count({ where: { action: "AUTH_NEW_DEVICE", actorUserId: target.id } }), 0, "El mismo dispositivo no avisa");
    await login(target.username, password, 200, "Mozilla/5.0 (Linux; Android 14) Chrome/130.0 Mobile");
    assert(await prisma.auditLog.findFirst({ where: { action: "AUTH_NEW_DEVICE", actorUserId: target.id } }));
    assert(await prisma.memberNotification.findFirst({ where: { userId: target.id, title: "Nuevo inicio de sesión", body: { contains: "Android" } } }));

    // --- Cerrar todas las sesiones ---
    await call(`/security/users/${target.id}/revoke-sessions`, 400, admin, "POST", { reason: "corto" });
    const revoked = await call(`/security/users/${target.id}/revoke-sessions`, 200, admin, "POST", { reason: "Contraseña posiblemente compartida" });
    assert(revoked.revoked >= 3);
    await call("/members/notifications", 401, unlocked.tokens.accessToken);
    await call(`/security/users/${users[0]!.id}/revoke-sessions`, 400, admin, "POST", { reason: "No puedo cerrar las mías así" });

    // --- Auditoria inalterable ---
    const entry = await prisma.auditLog.findFirstOrThrow({ where: { action: "AUTH_ACCOUNT_LOCKED" } });
    await assert.rejects(() => prisma.auditLog.update({ where: { id: entry.id }, data: { action: "MANIPULADO" } }), /inalterable/);
    await assert.rejects(() => prisma.auditLog.delete({ where: { id: entry.id } }), /inalterable/);
    await assert.rejects(() => prisma.auditLog.deleteMany({ where: { action: "AUTH_LOGIN_FAILED" } }), /inalterable/);
    await assert.rejects(() => prisma.$executeRawUnsafe(`TRUNCATE "AuditLog"`), /inalterable/);
    const { purgeAuditLogs } = await import("../utils/audit-purge");
    const temp = await prisma.auditLog.create({ data: { action: "TEST_TEMP", entityType: "System", entityId: "temp" } });
    assert.equal((await purgeAuditLogs(prisma, { id: temp.id })).count, 1, "La purga explícita sí funciona");
    // Eliminar un usuario desvincula su autoria sin borrar sus registros.
    const ghost = await prisma.user.create({ data: { username: "hard_ghost", passwordHash } });
    const ghostLog = await prisma.auditLog.create({ data: { actorUserId: ghost.id, action: "TEST_GHOST", entityType: "System", entityId: "ghost" } });
    await prisma.user.delete({ where: { id: ghost.id } });
    assert.equal((await prisma.auditLog.findUniqueOrThrow({ where: { id: ghostLog.id } })).actorUserId, null);

    // --- Celular compartido al fichar ---
    const station = await prisma.station.create({ data: { name: "Base prueba", latitude: -33, longitude: -64 } });
    const qr = await prisma.qrChallenge.create({ data: { stationId: station.id, tokenHash: randomUUID(), expiresAt: new Date() } });
    await prisma.attendance.create({ data: { userId: users[1]!.id, stationId: station.id, status: "CLOSED", checkInQrId: qr.id, checkInTrust: "HIGH", checkInAt: new Date(Date.now() - 3 * 3600000), checkOutAt: new Date(Date.now() - 2 * 3600000), checkInDevice: "device-compartido" } });
    const mine = await prisma.attendance.create({ data: { userId: users[2]!.id, stationId: station.id, status: "OPEN", checkInQrId: qr.id, checkInTrust: "HIGH", checkInAt: new Date(), checkInDevice: "device-compartido" } });
    const { recordSharedDevice } = await import("../utils/gps-suspicion");
    await prisma.$transaction((tx) => recordSharedDevice(tx, users[2]!.id, mine.id, "device-compartido"));
    assert.equal((await prisma.attendance.findUniqueOrThrow({ where: { id: mine.id } })).checkInTrust, "MEDIUM");
    assert(await prisma.auditLog.findFirst({ where: { action: "ATTENDANCE_SHARED_DEVICE", entityId: mine.id } }));
    await prisma.$transaction((tx) => recordSharedDevice(tx, users[1]!.id, mine.id, "otro-celular"));
    assert.equal(await prisma.auditLog.count({ where: { action: "ATTENDANCE_SHARED_DEVICE" } }), 1, "Un celular propio no se marca");

    // --- Alertas en rafaga ---
    for (let i = 0; i < 3; i++) await call("/alerts", 201, firefighter, "POST", { type: "OTHER", priority: "LOW", location: "Plaza central " + i, description: "Prueba de ráfaga" });
    assert(await prisma.auditLog.findFirst({ where: { action: "ALERT_BURST_DETECTED", actorUserId: users[2]!.id } }), "La tercera alerta seguida se informa");

    // --- Anomalias: borrado masivo ---
    await prisma.auditLog.createMany({ data: Array.from({ length: 10 }, (_, i) => ({ actorUserId: users[2]!.id, action: "TASK_DELETED", entityType: "WorkTask", entityId: "t" + i })) });
    const { detectSecurityAnomalies } = await import("../modules/security/security.service");
    assert.equal(await detectSecurityAnomalies(), 1);
    assert.equal(await detectSecurityAnomalies(), 0, "Se avisa una sola vez por franja");
    assert(await prisma.memberNotification.findFirst({ where: { userId: users[0]!.id, title: "Muchas eliminaciones o anulaciones seguidas" } }));

    // --- Estadisticas de horas: normales y de guardia separadas ---
    const day = stationDate(new Date(Date.now() - 3 * 86400000));
    await prisma.shift.create({ data: { date: new Date(day), startTime: "08:00", endTime: "20:00", shiftType: "Guardia diurna", period: "DAY", createdByUserId: users[1]!.id, assignments: { create: { userId: users[3]!.id } } } });
    // Presencia de 06:00 a 12:00: 2 h antes de la guardia (normales) y 4 h dentro (guardia).
    await prisma.attendance.create({ data: { userId: users[3]!.id, stationId: station.id, status: "CLOSED", checkInQrId: qr.id, checkInTrust: "HIGH", checkOutTrust: "HIGH", checkInAt: new Date(`${day}T06:00:00-03:00`), checkOutAt: new Date(`${day}T12:00:00-03:00`) } });
    const target2 = (await login(target.username, password, 200)).tokens.accessToken;
    const [year, month] = day.split("-").map(Number);
    const normal = await call(`/station/reports/hours?scope=month&year=${year}&month=${month}&kind=normal`, 200, target2);
    const guard = await call(`/station/reports/hours?scope=month&year=${year}&month=${month}&kind=guard`, 200, target2);
    assert.equal(normal.totalMinutes, 120); assert.equal(guard.totalMinutes, 240);
    assert.equal(normal.audience, "SELF");
    assert.equal(normal.blocks[3], 0); assert.equal(normal.blocks[0], 120, "06 a 08 cae en la franja Mañana");
    const weekday = (new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7;
    assert.equal(guard.weekdays[weekday], 240);
    const all = await call(`/station/reports/hours?scope=year&year=${year}&kind=guard`, 200, admin);
    assert.equal(all.audience, "ALL"); assert(all.top.some((t: { userId: string; minutes: number }) => t.userId === users[3]!.id && t.minutes === 240));
    await call(`/station/reports/hours?scope=month&year=${year}&kind=guard`, 400, admin);

    // --- Riesgo de incendio: responde con datos o con un aviso claro si no hay conexion ---
    const fire = await raw("/station/fire-risk", firefighter); paths++;
    assert([200, 503].includes(fire.status));
    if (fire.status === 200) { const data = await fire.json(); assert(data.levelIndex >= 0 && data.levelIndex <= 4); assert(typeof data.current.windFrom === "string"); }

    console.log(`Seguridad: ${paths} caminos HTTP aprobados; bloqueo de cuenta, dispositivo nuevo, cierre de sesiones, auditoría inalterable, celular compartido, alertas en ráfaga, borrado masivo, horas normales y de guardia.`);
  } finally {
    if (server) await new Promise<void>((r) => server!.close(() => r()));
    if (db) { const { flushRequestAudit } = await import("../middlewares/request-audit.middleware"); await flushRequestAudit(); }
    await db?.$disconnect(); process.env.DATABASE_URL = original;
    if (!/^hardening_verify_[a-f0-9]{16}$/.test(schema)) throw Error("Esquema inválido");
    await root.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await root.$disconnect();
  }
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
