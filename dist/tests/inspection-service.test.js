"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const prisma_1 = require("../config/prisma");
const inspections_service_1 = require("../modules/inspections/inspections.service");
const input = {
    draftId: "draft",
    vehicleId: "vehicle", inspectionDate: "2020-01-02", inspectionTime: "12:00",
    leaderUserId: "user", responsibleUserIds: ["user"], createdByUserId: "user",
    items: [{ inventoryItemId: "material", observedQuantity: 2, result: "OK" }],
};
function mockDatabase(context, latest = null, blocking = false, closedAt = null) {
    context.mock.method(Date, "now", () => new Date("2020-01-02T16:00:00Z").getTime());
    const writes = { asset: [], inventory: [], items: [], audit: [], control: [] };
    const tx = {
        $queryRaw: async () => [],
        controlDraft: { findUnique: async () => ({ id: "draft", ownerId: "user", vehicleId: "vehicle", startedAt: new Date("2020-01-02T15:00:00Z"), closedAt: null, participants: [{ userId: "user", attendanceId: "qr-presence", joinedAt: "2020-01-02T15:00:00.000Z" }] }), update: async () => ({}) },
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
        maintenanceJob: { create: async () => ({ id: "repair-job" }), findFirst: async (query) => query.select.id
                ? (blocking ? { id: "job" } : null)
                : (closedAt ? { resolvedAt: closedAt } : null) },
        inspection: {
            update: async () => ({}),
            findFirst: async () => latest,
            create: async (query) => { writes.control.push(query.data); return { id: "control" }; },
            findUnique: async () => ({ id: "control" }),
        },
        inspectionResponsible: { createMany: async () => ({ count: 1 }) },
        inspectionItem: { create: async (query) => { writes.items.push(query.data); } },
        vehicleInventoryItem: {
            findUnique: async () => ({ expectedQuantity: 2 }),
            update: async (query) => { writes.inventory.push(query.data); },
        },
        asset: { update: async (query) => { writes.asset.push(query.data); } },
        auditLog: { create: async (query) => { writes.audit.push(query.data); } },
    };
    const originalTransaction = prisma_1.prisma.$transaction;
    prisma_1.prisma.$transaction = async (callback, options) => {
        strict_1.default.equal(options.isolationLevel, "Serializable");
        return callback(tx);
    };
    context.after(() => { prisma_1.prisma.$transaction = originalTransaction; });
    return writes;
}
(0, node_test_1.test)("Un control historico queda auditado sin sobrescribir el movil", async (context) => {
    const writes = mockDatabase(context, { inspectionDate: new Date("2020-01-03T00:00:00Z"), inspectionTime: "12:00" });
    await (0, inspections_service_1.createInspection)(input);
    strict_1.default.equal(writes.control.length, 1);
    strict_1.default.equal(writes.asset.length, 0);
    strict_1.default.equal(writes.inventory.length, 0);
    strict_1.default.equal(writes.audit[0].metadata.appliesToCurrentState, false);
    strict_1.default.equal(writes.items[0].expectedQuantity, 2);
});
(0, node_test_1.test)("El control mas reciente actualiza inventario y estado operativo", async (context) => {
    const writes = mockDatabase(context);
    await (0, inspections_service_1.createInspection)(input);
    strict_1.default.equal(writes.asset[0].status, "OPERATIONAL");
    strict_1.default.equal(writes.inventory[0].state, "OK");
    strict_1.default.equal(writes.audit[0].metadata.appliesToCurrentState, true);
});
(0, node_test_1.test)("Un faltante pone el movil en mantenimiento", async (context) => {
    const writes = mockDatabase(context);
    await (0, inspections_service_1.createInspection)({
        ...input,
        items: [{ inventoryItemId: "material", observedQuantity: 1, result: "MISSING", observations: "Falta una manguera" }],
    });
    strict_1.default.equal(writes.asset[0].status, "MAINTENANCE");
    strict_1.default.equal(writes.inventory[0].state, "OUT");
});
(0, node_test_1.test)("Un control futuro se rechaza antes de escribir", async (context) => {
    const writes = mockDatabase(context);
    await strict_1.default.rejects((0, inspections_service_1.createInspection)({ ...input, inspectionDate: "2099-01-01" }), /futura|semana/);
    strict_1.default.equal(writes.control.length, 0);
    strict_1.default.equal(writes.asset.length, 0);
});
(0, node_test_1.test)("Un control sin faltantes no libera un mantenimiento bloqueante", async (context) => {
    const writes = mockDatabase(context, null, true);
    await (0, inspections_service_1.createInspection)(input);
    strict_1.default.equal(writes.asset[0].status, "MAINTENANCE");
});
(0, node_test_1.test)("Un control anterior a la reparacion no certifica el movil reparado", async (context) => {
    const writes = mockDatabase(context, null, false, new Date("2020-01-03T12:00:00Z"));
    await (0, inspections_service_1.createInspection)(input);
    strict_1.default.equal(writes.asset[0].status, "MAINTENANCE");
    strict_1.default.equal(writes.audit[0].metadata.needsRecheck, true);
});
