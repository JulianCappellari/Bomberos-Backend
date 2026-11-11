"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const incident_access_1 = require("../modules/incidents/incident-access");
(0, node_test_1.default)("Administrador y oficial autenticados como ADMIN no necesitan QR para redactar", async () => {
    const tx = {};
    strict_1.default.equal(await (0, incident_access_1.canWriteIncident)(tx, { userId: "admin", role: "ADMIN" }), true);
    await (0, incident_access_1.requireIncidentWrite)(tx, { userId: "oficial", role: "ADMIN" });
});
(0, node_test_1.default)("Los otros roles necesitan una permanencia QR, incluso el guardia y el suboficial", async () => {
    const tx = { attendance: { findFirst: async () => null }, missionCrew: { findFirst: async () => null } };
    for (const role of ["OPERATOR", "GUARD", "FIREFIGHTER"]) {
        strict_1.default.equal(await (0, incident_access_1.canWriteIncident)(tx, { userId: "user", role }), false);
        await strict_1.default.rejects(() => (0, incident_access_1.requireIncidentWrite)(tx, { userId: "user", role }), /QR/);
    }
});
(0, node_test_1.default)("La consulta de capacidad no convierte la respuesta Voy en permiso de escritura", async () => {
    let query;
    const tx = { attendance: { findFirst: async (args) => { query = args; return { id: "presence" }; } } };
    strict_1.default.equal(await (0, incident_access_1.canWriteIncident)(tx, { userId: "user", role: "FIREFIGHTER" }), true);
    const where = query.where;
    strict_1.default.equal(where.status, "OPEN");
    strict_1.default.deepEqual(where.checkInQrId, { not: null });
    (0, strict_1.default)(where.user, "No permite editar desde una dotacion que sigue fuera del cuartel");
});
