import test from "node:test";
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import { requireQrPresence } from "../utils/require-qr-presence";

test("La ejecucion operativa exige una permanencia abierta con ingreso QR no rechazado", async () => {
  let filter: any;
  const tx = { missionCrew: { findFirst: async () => null }, attendance: { findFirst: async (query: any) => { filter = query.where; return { id: "presence" }; } } } as unknown as Prisma.TransactionClient;
  await requireQrPresence(tx, "person");
  assert.equal(filter.userId, "person");
  assert.equal(filter.status, "OPEN");
  assert.deepEqual(filter.checkInQrId, { not: null });
  assert.deepEqual(filter.checkInTrust, { not: "REJECTED" });
  assert.ok(filter.checkInAt.lte instanceof Date);
});

test("Sin presencia QR se rechaza la accion, sin crear registros", async () => {
  const tx = { missionCrew: { findFirst: async () => null }, attendance: { findFirst: async () => null } } as unknown as Prisma.TransactionClient;
  await assert.rejects(() => requireQrPresence(tx, "person"), /registrar su ingreso.*QR/);
});
