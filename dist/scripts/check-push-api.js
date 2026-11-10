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
const webpush = __importStar(require("web-push"));
async function main() {
    if (process.env.NODE_ENV === "production")
        throw new Error("Prueba no autorizada en produccion");
    const schema = `push_verify_${(0, node_crypto_1.randomBytes)(8).toString("hex")}`, original = process.env.DATABASE_URL;
    const url = new URL(original);
    url.searchParams.set("schema", schema);
    const root = new client_1.PrismaClient({ datasourceUrl: original });
    let db, server;
    try {
        (0, node_child_process_1.execFileSync)(process.execPath, [require.resolve("prisma/build/index.js"), "migrate", "deploy"], { env: { ...process.env, DATABASE_URL: url.toString() }, stdio: "pipe" });
        process.env.DATABASE_URL = url.toString();
        const { prisma } = await Promise.resolve().then(() => __importStar(require("../config/prisma")));
        db = prisma;
        const { app } = await Promise.resolve().then(() => __importStar(require("../app")));
        const { queuePush: enqueue, deliverPush: deliver } = await Promise.resolve().then(() => __importStar(require("../modules/push/push-job")));
        // PostgreSQL timestamp rounding may be a millisecond ahead of the Node clock in this single-tick test.
        const queuePush = () => enqueue(new Date(Date.now() + 100));
        const deliverPush = (sender) => deliver(sender, new Date(Date.now() + 100));
        const { subscribePush } = await Promise.resolve().then(() => __importStar(require("../modules/push/push.service")));
        const { createAlert } = await Promise.resolve().then(() => __importStar(require("../modules/alerts/alerts.service")));
        server = app.listen(0, "127.0.0.1");
        await new Promise(resolve => server.once("listening", resolve));
        const address = server.address();
        (0, strict_1.default)(address && typeof address !== "string");
        const base = `http://127.0.0.1:${address.port}/api`, password = (0, node_crypto_1.randomUUID)() + "!Aa7", passwordHash = await bcrypt_1.default.hash(password, 10);
        let paths = 0;
        async function call(path, status, token, method = "GET", body) {
            const result = await fetch(base + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
            const data = await result.json();
            strict_1.default.equal(result.status, status, `${path}: ${JSON.stringify(data)}`);
            paths++;
            return data;
        }
        const users = [], tokens = [];
        for (let i = 0; i < 2; i++) {
            const user = await prisma.user.create({ data: { username: `push_test_${i}`, role: "FIREFIGHTER", passwordHash, emergencyStatusConfirmedAt: new Date(), profile: { create: { fullName: `Prueba ${i}`, rank: "Bombero", dni: `PUSH-${i}`, badge: `PUSH-${i}` } } } });
            users.push(user);
            tokens.push((await call("/auth/login", 200, undefined, "POST", { username: user.username, password })).tokens.accessToken);
        }
        await call("/push", 401);
        delete process.env.WEB_PUSH_PUBLIC_KEY;
        delete process.env.WEB_PUSH_PRIVATE_KEY;
        delete process.env.WEB_PUSH_SUBJECT;
        strict_1.default.equal((await call("/push", 200, tokens[0])).enabled, false);
        const pair = (0, node_crypto_1.createECDH)("prime256v1");
        pair.generateKeys();
        const input = { endpoint: "https://web.push.apple.com/testing-only-no-network", keys: { p256dh: pair.getPublicKey().toString("base64url"), auth: (0, node_crypto_1.randomBytes)(16).toString("base64url") } };
        await call("/push/subscriptions", 503, tokens[0], "POST", input);
        const vapid = webpush.generateVAPIDKeys();
        process.env.WEB_PUSH_PUBLIC_KEY = vapid.publicKey;
        process.env.WEB_PUSH_PRIVATE_KEY = vapid.privateKey;
        process.env.WEB_PUSH_SUBJECT = "mailto:testing@example.invalid";
        await call("/push/subscriptions", 400, tokens[0], "POST", { ...input, endpoint: "https://127.0.0.1/internal" });
        const first = await call("/push/subscriptions", 201, tokens[0], "POST", input);
        const repeated = await call("/push/subscriptions", 201, tokens[0], "POST", input);
        strict_1.default.equal(first.id, repeated.id);
        await call("/push/subscriptions", 409, tokens[1], "POST", input);
        await call(`/push/subscriptions/${first.id}`, 200, tokens[1], "DELETE");
        strict_1.default.equal(await prisma.pushSubscription.count(), 1);
        const status = await call("/push", 200, tokens[0]);
        strict_1.default.equal(status.enabled, true);
        strict_1.default.equal(status.publicKey, vapid.publicKey);
        for (const secret of [vapid.privateKey, input.endpoint, input.keys.auth, input.keys.p256dh])
            (0, strict_1.default)(!JSON.stringify(status).includes(secret));
        await call("/push/test", 202, tokens[0], "POST", {});
        await queuePush();
        await queuePush();
        strict_1.default.equal(await prisma.pushDelivery.count(), 1);
        let attempts = 0;
        strict_1.default.equal(await deliverPush(async () => { attempts++; throw { statusCode: 503 }; }), 0);
        const retry = await prisma.pushDelivery.findFirstOrThrow();
        strict_1.default.equal(retry.attempts, 1);
        strict_1.default.equal(retry.finishedAt, null);
        strict_1.default.equal(retry.errorCode, "HTTP_503");
        await prisma.pushDelivery.update({ where: { id: retry.id }, data: { nextAttemptAt: new Date(0) } });
        const captured = [];
        const sender = async (_sub, payload, options) => { attempts++; captured.push({ payload, options }); };
        await Promise.all([deliverPush(sender), deliverPush(sender)]);
        strict_1.default.equal(attempts, 2);
        strict_1.default.equal(captured.length, 1);
        (0, strict_1.default)(!captured[0].payload.includes("Prueba"));
        strict_1.default.equal(captured[0].options.urgency, "normal");
        await deliverPush(sender);
        strict_1.default.equal(attempts, 2);
        const session = await prisma.authSession.findFirstOrThrow({ where: { userId: users[0].id } });
        const actor = { userId: users[0].id, sessionId: session.id };
        const otherDevice = await subscribePush({ ...input, endpoint: "https://fcm.googleapis.com/testing-only-no-network" }, actor);
        // New devices never receive the existing personal history.
        await queuePush();
        strict_1.default.equal(await prisma.pushDelivery.count(), 1);
        await prisma.memberNotification.createMany({ data: Array.from({ length: 60 }, () => ({ userId: users[0].id, title: "Backlog sintetico para prueba de prioridad", href: "/notifications" })) });
        const alert = await createAlert({ type: "FIRE", priority: "HIGH", location: "Ubicacion privada de prueba", createdByUserId: users[0].id });
        strict_1.default.equal(await prisma.memberNotification.count({ where: { dedupeKey: { startsWith: `alert:${alert.id}:` } } }), 2);
        await queuePush();
        strict_1.default.equal(await prisma.memberNotification.count({ where: { dedupeKey: { startsWith: `alert:${alert.id}:` }, pushQueuedAt: { not: null } } }), 2, "La convocatoria no debe quedar detras de sesenta avisos comunes");
        await prisma.memberNotification.deleteMany({ where: { title: "Backlog sintetico para prueba de prioridad" } });
        strict_1.default.equal(await deliverPush(sender), 2);
        const urgent = captured.slice(-2);
        (0, strict_1.default)(urgent.every(r => r.options.urgency === "high" && Number(r.options.TTL) <= 900));
        (0, strict_1.default)(!JSON.stringify(urgent).includes("Ubicacion privada"));
        const cancelled = await createAlert({ type: "FIRE", priority: "LOW", location: "Aviso cancelado", createdByUserId: users[0].id });
        await queuePush();
        await prisma.alert.update({ where: { id: cancelled.id }, data: { status: "CANCELLED" } });
        strict_1.default.equal(await deliverPush(sender), 0);
        strict_1.default.equal(await prisma.pushDelivery.count({ where: { errorCode: "ALERT_NOT_ACTIVE" } }), 2);
        const read = await prisma.memberNotification.create({ data: { userId: users[0].id, title: "Privado leido", href: "/notifications" } });
        await queuePush();
        await prisma.memberNotification.update({ where: { id: read.id }, data: { readAt: new Date() } });
        strict_1.default.equal(await deliverPush(sender), 0);
        await prisma.memberNotification.create({ data: { userId: users[0].id, title: "Sesion revocada", href: "/notifications" } });
        await queuePush();
        await prisma.authSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
        strict_1.default.equal(await deliverPush(sender), 0);
        // Re-registering after a revoked session requires a real new login and replaces the old capability binding.
        const fresh = await call("/auth/login", 200, undefined, "POST", { username: users[0].username, password });
        const newSession = await prisma.authSession.findFirstOrThrow({ where: { userId: users[0].id, revokedAt: null } });
        const renewed = await subscribePush(input, { userId: users[0].id, sessionId: newSession.id });
        strict_1.default.notEqual(renewed.id, first.id);
        strict_1.default.equal(await prisma.pushSubscription.findUnique({ where: { id: otherDevice.id } }), null);
        await prisma.memberNotification.create({ data: { userId: users[0].id, title: "Suscripcion caducada", href: "/notifications" } });
        await queuePush();
        await deliverPush(async () => { throw { statusCode: 410 }; });
        strict_1.default.equal(await prisma.pushSubscription.count(), 0);
        await call("/push/test", 409, fresh.tokens.accessToken, "POST", {});
        console.log(`Web Push: ${paths} caminos HTTP y cola/reintentos/concurrencia/cancelacion/revocacion aprobados. Sin envios de red.`);
    }
    finally {
        if (server)
            await new Promise(resolve => server.close(() => resolve()));
        if (db) {
            const { flushRequestAudit } = await Promise.resolve().then(() => __importStar(require("../middlewares/request-audit.middleware")));
            await flushRequestAudit();
        }
        await db?.$disconnect();
        process.env.DATABASE_URL = original;
        if (!/^push_verify_[a-f0-9]{16}$/.test(schema))
            throw new Error("Esquema temporal invalido");
        await root.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await root.$disconnect();
    }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
