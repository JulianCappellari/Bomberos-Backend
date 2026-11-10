"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const strict_1 = __importDefault(require("node:assert/strict"));
const node_crypto_1 = require("node:crypto");
const bcrypt_1 = __importDefault(require("bcrypt"));
const app_1 = require("../app");
const prisma_1 = require("../config/prisma");
async function main() {
    const runId = (0, node_crypto_1.randomUUID)().slice(0, 8);
    const password = (0, node_crypto_1.randomUUID)() + "!Aa7";
    const userIds = [];
    let server;
    try {
        const passwordHash = await bcrypt_1.default.hash(password, 10);
        for (const role of ["ADMIN", "FIREFIGHTER"]) {
            const user = await prisma_1.prisma.user.create({
                data: { username: `__contacts_test_${runId}_${role}`, passwordHash, role },
            });
            userIds.push(user.id);
        }
        server = app_1.app.listen(0, "127.0.0.1");
        await new Promise((resolve) => server.once("listening", resolve));
        const address = server.address();
        (0, strict_1.default)(address && typeof address !== "string");
        const base = `http://127.0.0.1:${address.port}/api`;
        async function request(path, method = "GET", body, token) {
            return fetch(base + path, {
                method,
                headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
                ...(body ? { body: JSON.stringify(body) } : {}),
            });
        }
        async function login(role) {
            const response = await request("/auth/login", "POST", { username: `__contacts_test_${runId}_${role}`, password });
            strict_1.default.equal(response.status, 200);
            return (await response.json()).tokens.accessToken;
        }
        const admin = await login("ADMIN");
        const firefighter = await login("FIREFIGHTER");
        const input = { name: `Central prueba ${runId}`, category: "Pruebas", phone: "100", isEmergency: true };
        strict_1.default.equal((await request("/contacts")).status, 401);
        strict_1.default.equal((await request("/contacts", "POST", input, firefighter)).status, 403);
        strict_1.default.equal((await request("/contacts", "POST", { name: "Sin canal", category: "Pruebas" }, admin)).status, 400);
        const createdResponse = await request("/contacts", "POST", input, admin);
        strict_1.default.equal(createdResponse.status, 201);
        const contact = await createdResponse.json();
        strict_1.default.equal(contact.revision, 1);
        strict_1.default.equal("passwordHash" in contact.createdBy, false);
        const readResponse = await request(`/contacts?q=${runId}&emergency=true`, "GET", undefined, firefighter);
        strict_1.default.equal(readResponse.status, 200);
        strict_1.default.equal((await readResponse.json()).length, 1);
        strict_1.default.equal((await request(`/contacts/${contact.id}`, "PUT", { ...input, revision: 1 }, firefighter)).status, 403);
        const updatedResponse = await request(`/contacts/${contact.id}`, "PUT", { ...input, name: "Central actualizada", revision: 1 }, admin);
        strict_1.default.equal(updatedResponse.status, 200);
        strict_1.default.equal((await updatedResponse.json()).revision, 2);
        strict_1.default.equal((await request(`/contacts/${contact.id}`, "PUT", { ...input, revision: 1 }, admin)).status, 409);
        strict_1.default.equal((await request(`/contacts/${contact.id}?revision=2`, "DELETE", undefined, firefighter)).status, 403);
        strict_1.default.equal((await request(`/contacts/${contact.id}?revision=1`, "DELETE", undefined, admin)).status, 409);
        strict_1.default.equal((await request(`/contacts/${contact.id}?revision=2`, "DELETE", undefined, admin)).status, 200);
        const deleted = await prisma_1.prisma.operationalContact.findUniqueOrThrow({ where: { id: contact.id } });
        (0, strict_1.default)(deleted.deletedAt);
        strict_1.default.equal(deleted.revision, 3);
        strict_1.default.equal(await prisma_1.prisma.auditLog.count({ where: { entityType: "OperationalContact", entityId: contact.id } }), 3);
        console.log("Contactos API OK: autenticacion, permisos, CRUD, filtros, conflictos y auditoria.");
    }
    finally {
        if (server)
            await new Promise((resolve) => server.close(() => resolve()));
        if (userIds.length) {
            await prisma_1.prisma.$transaction([
                prisma_1.prisma.auditLog.deleteMany({ where: { actorUserId: { in: userIds } } }),
                prisma_1.prisma.operationalContact.deleteMany({ where: { createdByUserId: { in: userIds } } }),
                prisma_1.prisma.user.deleteMany({ where: { id: { in: userIds } } }),
            ]);
        }
        await prisma_1.prisma.$disconnect();
    }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
