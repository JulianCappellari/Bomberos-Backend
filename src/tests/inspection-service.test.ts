import assert from "node:assert/strict";
import { test, TestContext } from "node:test";
import { prisma } from "../config/prisma";
import { createInspection } from "../modules/inspections/inspections.service";

const input = {
  draftId:"draft",
  vehicleId: "vehicle", inspectionDate: "2020-01-02", inspectionTime: "12:00",
  leaderUserId: "user", responsibleUserIds: ["user"], createdByUserId: "user",
  items: [{ inventoryItemId: "material", observedQuantity: 2, result: "OK" as const }],
};

function mockDatabase(context: TestContext, latest: { inspectionDate: Date; inspectionTime: string } | null = null, blocking = false, closedAt: Date | null = null) {
  context.mock.method(Date, "now", () => new Date("2020-01-02T16:00:00Z").getTime());
  const writes: { asset: any[]; inventory: any[]; items: any[]; audit: any[]; control: any[] } =
    { asset: [], inventory: [], items: [], audit: [], control: [] };
  const tx = {
    $queryRaw:async()=>[],
    controlDraft:{findUnique:async()=>({id:"draft",ownerId:"user",vehicleId:"vehicle",startedAt:new Date("2020-01-02T15:00:00Z"),closedAt:null,participants:[{userId:"user",attendanceId:"qr-presence",joinedAt:"2020-01-02T15:00:00.000Z"}]}),update:async()=>({})},
    missionCrew: { findFirst: async () => null },
    attendance: { findFirst: async () => ({ id: "qr-presence" }) },
    controlGroupMember: { findUnique: async () => ({ group: { startsOn: new Date("2020-01-01"), repeatWeeks: 4, members: [{ userId: "user" }] } }) },
    memberNotification: { createMany: async () => ({ count: 1 }) },
    vehicle: { findUnique: async () => ({
      assetId: "asset", asset: { deletedAt: null },
      compartments: [{ items: [{ id: "material", name: "Manguera", expectedQuantity: 2 }] }],
    }) },
    user: { findMany: async () => [{ id: "user" }] },
    workTask: { create: async () => ({ id: "repair-task" }) },
    maintenanceJob: { create: async () => ({ id: "repair-job" }), findFirst: async (query: any) => query.select.id
      ? (blocking ? { id: "job" } : null)
      : (closedAt ? { resolvedAt: closedAt } : null) },
    inspection: {
      update: async () => ({}),
      findFirst: async () => latest,
      create: async (query: any) => { writes.control.push(query.data); return { id: "control" }; },
      findUnique: async () => ({ id: "control" }),
    },
    inspectionResponsible: { createMany: async () => ({ count: 1 }) },
    inspectionItem: { create: async (query: any) => { writes.items.push(query.data); } },
    vehicleInventoryItem: {
      findUnique: async () => ({ expectedQuantity: 2 }),
      update: async (query: any) => { writes.inventory.push(query.data); },
    },
    asset: { update: async (query: any) => { writes.asset.push(query.data); } },
    auditLog: { create: async (query: any) => { writes.audit.push(query.data); } },
  };
  const originalTransaction = prisma.$transaction;
  (prisma as any).$transaction = async (callback: any, options: any) => {
    assert.equal(options.isolationLevel, "Serializable");
    return callback(tx);
  };
  context.after(() => { prisma.$transaction = originalTransaction; });
  return writes;
}

test("Un control historico queda auditado sin sobrescribir el movil", async (context) => {
  const writes = mockDatabase(context, { inspectionDate: new Date("2020-01-03T00:00:00Z"), inspectionTime: "12:00" });
  await createInspection(input);
  assert.equal(writes.control.length, 1);
  assert.equal(writes.asset.length, 0);
  assert.equal(writes.inventory.length, 0);
  assert.equal(writes.audit[0].metadata.appliesToCurrentState, false);
  assert.equal(writes.items[0].expectedQuantity, 2);
});

test("El control mas reciente actualiza inventario y estado operativo", async (context) => {
  const writes = mockDatabase(context);
  await createInspection(input);
  assert.equal(writes.asset[0].status, "OPERATIONAL");
  assert.equal(writes.inventory[0].state, "OK");
  assert.equal(writes.audit[0].metadata.appliesToCurrentState, true);
});

test("Un faltante pone el movil en mantenimiento", async (context) => {
  const writes = mockDatabase(context);
  await createInspection({
    ...input,
    items: [{ inventoryItemId: "material", observedQuantity: 1, result: "MISSING", observations: "Falta una manguera" }],
  });
  assert.equal(writes.asset[0].status, "MAINTENANCE");
  assert.equal(writes.inventory[0].state, "OUT");
});

test("Un control futuro se rechaza antes de escribir", async (context) => {
  const writes = mockDatabase(context);
  await assert.rejects(createInspection({ ...input, inspectionDate: "2099-01-01" }), /futura|semana/);
  assert.equal(writes.control.length, 0);
  assert.equal(writes.asset.length, 0);
});

test("Un control sin faltantes no libera un mantenimiento bloqueante", async (context) => {
  const writes = mockDatabase(context, null, true);
  await createInspection(input);
  assert.equal(writes.asset[0].status, "MAINTENANCE");
});

test("Un control anterior a la reparacion no certifica el movil reparado", async (context) => {
  const writes = mockDatabase(context, null, false, new Date("2020-01-03T12:00:00Z"));
  await createInspection(input);
  assert.equal(writes.asset[0].status, "MAINTENANCE");
  assert.equal(writes.audit[0].metadata.needsRecheck, true);
});
