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
const bcrypt_1 = __importDefault(require("bcrypt"));
const sharp_1 = __importDefault(require("sharp"));
const isolated_api_test_1 = require("./isolated-api-test");
const station_time_1 = require("../utils/station-time");
const node_child_process_1 = require("node:child_process");
const node_path_1 = __importDefault(require("node:path"));
const node_readline_1 = require("node:readline");
(0, isolated_api_test_1.isolatedApiTest)(async () => {
    const { prisma } = await Promise.resolve().then(() => __importStar(require("../config/prisma"))), { app } = await Promise.resolve().then(() => __importStar(require("../app"))), { flushRequestAudit } = await Promise.resolve().then(() => __importStar(require("../middlewares/request-audit.middleware")));
    const preview = process.argv.includes("--preview");
    let web;
    const server = app.listen(preview ? 4000 : 0, "127.0.0.1");
    await new Promise((r, reject) => { server.once("listening", r); server.once("error", reject); });
    const address = server.address();
    (0, strict_1.default)(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}/api`;
    let paths = 0;
    try {
        async function call(path, status, token, method = "GET", body) { const res = await fetch(base + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }); const data = await res.json(); strict_1.default.equal(res.status, status, `${path}: ${JSON.stringify(data)}`); paths++; return data; }
        const password = (0, node_crypto_1.randomUUID)() + "!Aa7", passwordHash = await bcrypt_1.default.hash(password, 10), users = [], tokens = [];
        for (const [i, rank] of ["Administrador", "Oficial", "Sub oficial", "Bombero", "Guardia", "Sub oficial"].entries()) {
            const user = await prisma.user.create({ data: { username: "finance_test_" + i, role: "FIREFIGHTER", passwordHash, profile: { create: { rank, fullName: "Prueba finanzas " + i, dni: "FIN-" + i, badge: "FIN-" + i } } } });
            users.push(user);
            tokens.push((await call("/auth/login", 200, undefined, "POST", { username: user.username, password })).tokens.accessToken);
        }
        const [admin, officer, sub, staff, guard] = tokens;
        await call(`/finance/access/${users[1].id}`, 403, officer, "POST", { enabled: true, reason: "Un oficial no puede otorgarse acceso financiero" });
        await call(`/finance/access/${users[3].id}`, 400, admin, "POST", { enabled: true, reason: "No se puede delegar a un bombero sin cargo de oficial" });
        await call("/finance", 403, officer);
        await call("/finance?state=paid&q=Prueba", 403, officer);
        await call(`/finance/access/${users[1].id}`, 403, sub, "POST", { enabled: true, reason: "No puede concederse acceso financiero" });
        await call(`/finance/access/${users[1].id}`, 200, admin, "POST", { enabled: true, reason: "Designación del oficial como jefe financiero" });
        await call("/finance", 401);
        for (const token of [sub, staff, guard])
            await call("/finance", 403, token);
        const photo = async (red) => (await (0, sharp_1.default)({ create: { width: 64, height: 64, channels: 3, background: { r: red, g: 100, b: 150 } } }).png().toBuffer()).toString("base64");
        const expense = { operationKey: (0, node_crypto_1.randomUUID)(), title: "Compra de insumos", notes: "Gasto personal para insumos del cuartel", occurredOn: (0, station_time_1.stationDate)(), amountCents: 12345, receiptUrl: "https://example.invalid/comprobante-insumos", receiptPhoto: await photo(10) };
        await call("/finance/expenses", 400, staff, "POST", { ...expense, amountCents: -1 });
        await call("/finance/expenses", 400, staff, "POST", { ...expense, receiptPhoto: undefined }); // O04: el enlace no sustituye una foto subida
        await call("/finance/expenses", 400, staff, "POST", { ...expense, receiptPhoto: Buffer.from("No es una imagen").toString("base64") });
        const row = await call("/finance/expenses", 201, staff, "POST", expense);
        strict_1.default.equal(Object.keys(row).sort().join(","), "id,message");
        const receiptResponse = await fetch(base + `/finance/expenses/${row.id}/receipt`, { headers: { Authorization: `Bearer ${admin}` } });
        strict_1.default.equal(receiptResponse.status, 200);
        strict_1.default.equal(receiptResponse.headers.get("content-type"), "image/jpeg");
        (0, strict_1.default)(receiptResponse.headers.get("cache-control")?.includes("no-store"));
        (0, strict_1.default)((await receiptResponse.arrayBuffer()).byteLength > 0);
        paths++;
        await call(`/finance/expenses/${row.id}/receipt`, 403, sub);
        await call(`/finance/expenses/${row.id}/receipt`, 403, guard);
        strict_1.default.equal((await call("/finance/expenses", 201, staff, "POST", expense)).id, row.id);
        await call("/finance/expenses", 409, staff, "POST", { ...expense, operationKey: (0, node_crypto_1.randomUUID)() });
        await call("/finance/expenses", 409, staff, "POST", { ...expense, amountCents: 12346 });
        await call(`/finance/expenses/${row.id}/review`, 403, sub, "POST", { revision: 1, status: "APPROVED", note: "Revisión sin permisos suficientes" });
        await call(`/finance/expenses/${row.id}/review`, 200, officer, "POST", { revision: 1, status: "APPROVED", note: "Comprobante verificado por jefatura" });
        await call(`/finance/expenses/${row.id}/review`, 409, officer, "POST", { revision: 1, status: "APPROVED", note: "Intento duplicado de aprobación" });
        let board = await call("/finance", 200, admin);
        strict_1.default.equal(board.totals.expenseDebtCents, 12345);
        const payment = { operationKey: (0, node_crypto_1.randomUUID)(), revision: 2, amountCents: 5000, reference: "Recibo de pago parcial 001" };
        const p = await call(`/finance/expenses/${row.id}/payments`, 201, admin, "POST", payment);
        strict_1.default.equal((await call(`/finance/expenses/${row.id}/payments`, 201, admin, "POST", payment)).id, p.id);
        board = await call("/finance", 200, admin);
        strict_1.default.equal(board.totals.expenseDebtCents, 7345);
        strict_1.default.equal(board.totals.expensePaidCents, 5000);
        await call(`/finance/expenses/${row.id}/payments`, 409, admin, "POST", { ...payment, operationKey: (0, node_crypto_1.randomUUID)(), revision: 3 });
        await call(`/finance/expenses/${row.id}/payments`, 409, admin, "POST", { ...payment, operationKey: (0, node_crypto_1.randomUUID)(), revision: 3, amountCents: 10000 });
        await call(`/finance/payments/${p.id}/reverse`, 200, admin, "POST", { reason: "Corrección de constancia cargada por error" });
        await call(`/finance/payments/${p.id}/reverse`, 409, admin, "POST", { reason: "Intento de reversión duplicada" });
        strict_1.default.equal((await call("/finance", 200, admin)).totals.expenseDebtCents, 12345);
        const own = await call("/finance/expenses", 201, admin, "POST", { ...expense, operationKey: (0, node_crypto_1.randomUUID)(), receiptPhoto: await photo(60), receiptUrl: "https://example.invalid/comprobante-propio" });
        await call(`/finance/expenses/${own.id}/review`, 403, admin, "POST", { revision: 1, status: "APPROVED", note: "No puede aprobar su propio gasto" });
        const asset = await prisma.asset.create({ data: { name: "Móvil financiero de prueba", assetType: "VEHICLE" } });
        const reviewedTrip = await prisma.waterTrip.create({ data: { operationKey: (0, node_crypto_1.randomUUID)(), requestHash: "a".repeat(64), assetId: asset.id, customer: "Cliente ficticio", destination: "Destino ficticio", departedAt: new Date(Date.now() - 7200000), returnedAt: new Date(Date.now() - 3600000), startOdometer: 10, endOdometer: 20, tripCount: 1, chargeCents: 10000, leaderUserId: users[3].id, createdByUserId: users[1].id, notes: "Viaje de prueba financiera", crew: { create: { userId: users[3].id, compensationCents: 2500 } } } });
        board = await call("/finance", 200, admin);
        strict_1.default.equal(board.totals.waterDebtCents, 0);
        strict_1.default.equal(board.totals.waterPendingCents, 2500);
        await call(`/finance/water/${reviewedTrip.id}/approve`, 403, officer, "POST", { revision: 1, note: "El autor no debe validar su propio registro" });
        await call(`/finance/water/${reviewedTrip.id}/approve`, 200, admin, "POST", { revision: 1, note: "Se comprobaron el viaje y las remuneraciones" });
        board = await call("/finance", 200, admin);
        strict_1.default.equal(board.totals.waterDebtCents, 2500);
        strict_1.default.equal(board.totals.waterPendingCents, 0);
        strict_1.default.equal(board.water[0].amountCents, 2500);
        strict_1.default.equal(board.totals.expenseDebtCents, 12345);
        const officialClaim = await call("/finance/expenses", 201, officer, "POST", { ...expense, operationKey: (0, node_crypto_1.randomUUID)(), title: "Gasto del oficial para doble autorización", receiptPhoto: await photo(110), receiptUrl: "https://example.invalid/comprobante-oficial" });
        await call(`/finance/expenses/${officialClaim.id}/review`, 409, admin, "POST", { revision: 1, status: "APPROVED", note: "El administrador no puede sustituir al quorum" });
        await call("/finance/officer-expenses", 403, staff);
        await call("/finance/officer-expenses", 403, guard);
        const queue = await call("/finance/officer-expenses", 200, sub);
        (0, strict_1.default)(queue.some((r) => r.id === officialClaim.id));
        (0, strict_1.default)(!queue.some((r) => r.id === row.id));
        const authorization = { revision: 1, note: "Primera comprobación independiente del gasto" };
        await call(`/finance/expenses/${officialClaim.id}/authorize`, 403, officer, "POST", authorization);
        await call(`/finance/expenses/${officialClaim.id}/authorize`, 200, sub, "POST", authorization);
        await call(`/finance/expenses/${officialClaim.id}/authorize`, 200, sub, "POST", authorization);
        strict_1.default.equal(await prisma.expenseApproval.count({ where: { claimId: officialClaim.id } }), 1);
        await call(`/finance/expenses/${officialClaim.id}/payments`, 409, admin, "POST", { operationKey: (0, node_crypto_1.randomUUID)(), revision: 2, amountCents: 100, reference: "No puede pagar sin segunda firma" });
        await call(`/finance/expenses/${officialClaim.id}/authorize`, 409, tokens[5], "POST", { revision: 1, note: "Segunda firma usando revisión obsoleta" });
        await call(`/finance/expenses/${officialClaim.id}/authorize`, 200, tokens[5], "POST", { revision: 2, note: "Segunda comprobación independiente del gasto" });
        strict_1.default.equal((await prisma.expenseClaim.findUniqueOrThrow({ where: { id: officialClaim.id } })).status, "APPROVED");
        await call(`/finance/expenses/${officialClaim.id}/payments`, 201, admin, "POST", { operationKey: (0, node_crypto_1.randomUUID)(), revision: 3, amountCents: 100, reference: "Pago permitido tras dos firmas" });
        const history = (await call("/finance", 200, admin)).items.find((r) => r.id === officialClaim.id);
        strict_1.default.equal(history.approvals.length, 2);
        (0, strict_1.default)(history.approvals.every((a) => a.user.username && a.createdAt && a.note));
        await call(`/finance/expenses/${own.id}/review`, 200, officer, "POST", { revision: 1, status: "APPROVED", note: "Revisión independiente del gasto del administrador" });
        const ownPayment = await call(`/finance/expenses/${own.id}/payments`, 201, officer, "POST", { operationKey: (0, node_crypto_1.randomUUID)(), revision: 2, amountCents: 100, reference: "Constancia para control de reversión propia" });
        await call(`/finance/payments/${ownPayment.id}/reverse`, 403, admin, "POST", { reason: "El beneficiario no puede revertir su constancia" });
        strict_1.default.equal((await prisma.expensePayment.findUniqueOrThrow({ where: { id: ownPayment.id } })).reversedAt, null);
        await call(`/finance/payments/${ownPayment.id}/reverse`, 200, officer, "POST", { reason: "Reversión independiente de constancia de prueba" });
        const concurrent = await call("/finance/expenses", 201, staff, "POST", { ...expense, operationKey: (0, node_crypto_1.randomUUID)(), title: "Prueba de pago concurrente", amountCents: 10000, receiptPhoto: await photo(160), receiptUrl: "https://example.invalid/comprobante-concurrente" });
        await call(`/finance/expenses/${concurrent.id}/review`, 200, officer, "POST", { revision: 1, status: "APPROVED", note: "Aprobación independiente para probar concurrencia" });
        const results = await Promise.all(["A", "B"].map(async (suffix) => { const response = await fetch(base + `/finance/expenses/${concurrent.id}/payments`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${admin}` }, body: JSON.stringify({ operationKey: (0, node_crypto_1.randomUUID)(), revision: 2, amountCents: 6000, reference: "Constancia concurrente " + suffix }) }); await response.json(); return response.status; }));
        paths += 2;
        strict_1.default.deepEqual(results.sort(), [201, 409]);
        strict_1.default.equal((await prisma.expensePayment.aggregate({ where: { claimId: concurrent.id, reversedAt: null }, _sum: { amountCents: true } }))._sum.amountCents, 6000);
        const filtered = await call("/finance?state=debt&q=concurrente", 200, admin);
        strict_1.default.equal(filtered.total, 1);
        strict_1.default.equal(filtered.items[0].id, concurrent.id);
        strict_1.default.equal(filtered.items[0].debtCents, 4000);
        (0, strict_1.default)((await call("/finance?state=pending", 200, admin)).items.every((r) => r.status === "PENDING"));
        strict_1.default.equal((await call("/finance?state=paid&q=concurrente", 200, admin)).total, 0);
        await call("/finance?state=invalid", 400, admin);
        const pagedData = Array.from({ length: 31 }, (_, index) => ({ operationKey: (0, node_crypto_1.randomUUID)(), userId: users[3].id, title: `Filtro pagina ${index}`, notes: "Gasto sintetico para verificar filtro antes de paginar", occurredOn: new Date((0, station_time_1.stationDate)()), amountCents: 100, status: "PENDING" }));
        await prisma.expenseClaim.createMany({ data: pagedData });
        strict_1.default.equal((await call("/finance?state=pending&q=Filtro%20pagina&page=2", 200, admin)).items.length, 1);
        await call(`/finance/access/${users[1].id}`, 200, admin, "POST", { enabled: false, reason: "Retiro del acceso financiero al concluir su función" });
        await call("/finance", 403, officer);
        console.log(`Finanzas: ${paths} caminos HTTP aprobados; privacidad, reintegros, pagos parciales, reversión y ganancias de agua sin duplicación.`);
        if (preview) {
            const { env } = await Promise.resolve().then(() => __importStar(require("../config/env")));
            env.corsOrigins.push("http://localhost:3217");
            web = (0, node_child_process_1.spawn)(process.execPath, [node_path_1.default.resolve("../Bomberos - Frontend/node_modules/next/dist/bin/next"), "start", "-p", "3217"], { cwd: node_path_1.default.resolve("../Bomberos - Frontend"), windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
            web.stdout.on("data", d => process.stdout.write(d));
            web.stderr.on("data", d => process.stderr.write(d));
            console.log(JSON.stringify({ url: "http://localhost:3217", admin: users[0].username, staff: users[3].username, password, notice: "Solo cuentas temporales. Enter cierra y elimina el esquema." }));
            const reader = (0, node_readline_1.createInterface)({ input: process.stdin });
            await new Promise(resolve => { const timer = setTimeout(() => reader.close(), 300000); reader.once("line", () => reader.close()); reader.once("close", () => { clearTimeout(timer); resolve(); }); });
        }
    }
    finally {
        if (web && web.exitCode === null) {
            const done = new Promise(r => web.once("exit", () => r()));
            web.kill();
            await done;
        }
        await new Promise(r => server.close(() => r()));
        await flushRequestAudit();
    }
}).catch(e => { console.error(e); process.exitCode = 1; });
