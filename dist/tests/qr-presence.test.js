"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const require_qr_presence_1 = require("../utils/require-qr-presence");
(0, node_test_1.default)("La ejecucion operativa exige una permanencia abierta con ingreso QR no rechazado", async () => {
    let filter;
    const tx = { missionCrew: { findFirst: async () => null }, attendance: { findFirst: async (query) => { filter = query.where; return { id: "presence" }; } } };
    await (0, require_qr_presence_1.requireQrPresence)(tx, "person");
    strict_1.default.equal(filter.userId, "person");
    strict_1.default.equal(filter.status, "OPEN");
    strict_1.default.deepEqual(filter.checkInQrId, { not: null });
    strict_1.default.deepEqual(filter.checkInTrust, { not: "REJECTED" });
    strict_1.default.ok(filter.checkInAt.lte instanceof Date);
});
(0, node_test_1.default)("Sin presencia QR se rechaza la accion, sin crear registros", async () => {
    const tx = { missionCrew: { findFirst: async () => null }, attendance: { findFirst: async () => null } };
    await strict_1.default.rejects(() => (0, require_qr_presence_1.requireQrPresence)(tx, "person"), /registrar su ingreso.*QR/);
});
