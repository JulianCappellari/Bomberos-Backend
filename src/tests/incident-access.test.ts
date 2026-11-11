import test from "node:test";
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import { canWriteIncident, requireIncidentWrite } from "../modules/incidents/incident-access";

test("Administrador y oficial autenticados como ADMIN no necesitan QR para redactar", async () => {
  const tx = {} as Prisma.TransactionClient;
  assert.equal(await canWriteIncident(tx, { userId: "admin", role: "ADMIN" }), true);
  await requireIncidentWrite(tx, { userId: "oficial", role: "ADMIN" });
});

test("La guardia de turno redacta sin QR: su cuenta no ficha para no sumar asistencia personal", async () => {
  const tx = {} as Prisma.TransactionClient;
  assert.equal(await canWriteIncident(tx, { userId: "guardia", role: "GUARD" }), true);
  await requireIncidentWrite(tx, { userId: "guardia", role: "GUARD" });
});

test("Los otros roles necesitan una permanencia QR, incluso el suboficial", async () => {
  const tx = { attendance: { findFirst: async () => null }, missionCrew: { findFirst: async () => null } } as unknown as Prisma.TransactionClient;
  for (const role of ["OPERATOR", "FIREFIGHTER"]) {
    assert.equal(await canWriteIncident(tx, { userId: "user", role }), false);
    await assert.rejects(() => requireIncidentWrite(tx, { userId: "user", role }), /QR/);
  }
});

test("La consulta de capacidad no convierte la respuesta Voy en permiso de escritura", async () => {
  let query: unknown;
  const tx = { attendance: { findFirst: async (args: unknown) => { query = args; return { id: "presence" }; } } } as unknown as Prisma.TransactionClient;
  assert.equal(await canWriteIncident(tx, { userId: "user", role: "FIREFIGHTER" }), true);
  const where = (query as { where: { status: string; checkInQrId: unknown; user: unknown } }).where;
  assert.equal(where.status, "OPEN"); assert.deepEqual(where.checkInQrId, { not: null });
  assert(where.user, "No permite editar desde una dotacion que sigue fuera del cuartel");
});
