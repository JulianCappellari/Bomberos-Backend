import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import bcrypt from "bcrypt";
import { app } from "../app";
import { prisma } from "../config/prisma";

async function main() {
  const runId = randomUUID().slice(0, 8);
  const password = randomUUID() + "!Aa7";
  const userIds: string[] = [];
  let server: ReturnType<typeof app.listen> | undefined;
  try {
    const passwordHash = await bcrypt.hash(password, 10);
    for (const role of ["ADMIN", "FIREFIGHTER"] as const) {
      const user = await prisma.user.create({
        data: { username: `__contacts_test_${runId}_${role}`, passwordHash, role },
      });
      userIds.push(user.id);
    }
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server!.once("listening", resolve));
    const address = server.address();
    assert(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}/api`;
    async function request(path: string, method = "GET", body?: unknown, token?: string) {
      return fetch(base + path, {
        method,
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    }
    async function login(role: string) {
      const response = await request("/auth/login", "POST", { username: `__contacts_test_${runId}_${role}`, password });
      assert.equal(response.status, 200);
      return (await response.json()).tokens.accessToken as string;
    }
    const admin = await login("ADMIN");
    const firefighter = await login("FIREFIGHTER");
    const input = { name: `Central prueba ${runId}`, category: "Pruebas", phone: "100", isEmergency: true };

    assert.equal((await request("/contacts")).status, 401);
    assert.equal((await request("/contacts", "POST", input, firefighter)).status, 403);
    assert.equal((await request("/contacts", "POST", { name: "Sin canal", category: "Pruebas" }, admin)).status, 400);
    const createdResponse = await request("/contacts", "POST", input, admin);
    assert.equal(createdResponse.status, 201);
    const contact = await createdResponse.json();
    assert.equal(contact.revision, 1);
    assert.equal("passwordHash" in contact.createdBy, false);

    const readResponse = await request(`/contacts?q=${runId}&emergency=true`, "GET", undefined, firefighter);
    assert.equal(readResponse.status, 200);
    assert.equal((await readResponse.json()).length, 1);
    assert.equal((await request(`/contacts/${contact.id}`, "PUT", { ...input, revision: 1 }, firefighter)).status, 403);
    const updatedResponse = await request(`/contacts/${contact.id}`, "PUT", { ...input, name: "Central actualizada", revision: 1 }, admin);
    assert.equal(updatedResponse.status, 200);
    assert.equal((await updatedResponse.json()).revision, 2);
    assert.equal((await request(`/contacts/${contact.id}`, "PUT", { ...input, revision: 1 }, admin)).status, 409);
    assert.equal((await request(`/contacts/${contact.id}?revision=2`, "DELETE", undefined, firefighter)).status, 403);
    assert.equal((await request(`/contacts/${contact.id}?revision=1`, "DELETE", undefined, admin)).status, 409);
    assert.equal((await request(`/contacts/${contact.id}?revision=2`, "DELETE", undefined, admin)).status, 200);
    const deleted = await prisma.operationalContact.findUniqueOrThrow({ where: { id: contact.id } });
    assert(deleted.deletedAt);
    assert.equal(deleted.revision, 3);
    assert.equal(await prisma.auditLog.count({ where: { entityType: "OperationalContact", entityId: contact.id } }), 3);
    console.log("Contactos API OK: autenticacion, permisos, CRUD, filtros, conflictos y auditoria.");
  } finally {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    if (userIds.length) {
      await prisma.$transaction([
        prisma.auditLog.deleteMany({ where: { actorUserId: { in: userIds } } }),
        prisma.operationalContact.deleteMany({ where: { createdByUserId: { in: userIds } } }),
        prisma.user.deleteMany({ where: { id: { in: userIds } } }),
      ]);
    }
    await prisma.$disconnect();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
