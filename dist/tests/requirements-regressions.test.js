"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const members_schemas_1 = require("../modules/members/members.schemas");
const participation_service_1 = require("../modules/members/participation.service");
const assets_schemas_1 = require("../modules/assets/assets.schemas");
const alerts_schemas_1 = require("../modules/alerts/alerts.schemas");
(0, node_test_1.test)("La emisión de alertas exige ubicación, prioridad, tipo y descripción", () => {
    const alert = { type: "OTHER", priority: "HIGH", location: "Calle de prueba", description: "Emergencia declarada" };
    (0, strict_1.default)(alerts_schemas_1.createAlertSchema.safeParse(alert).success);
    (0, strict_1.default)(!alerts_schemas_1.createAlertSchema.safeParse({ ...alert, description: "   " }).success);
    (0, strict_1.default)(!alerts_schemas_1.createAlertSchema.safeParse({ ...alert, description: undefined }).success);
    (0, strict_1.default)(!alerts_schemas_1.createAlertSchema.safeParse({ ...alert, location: "" }).success);
});
(0, node_test_1.test)("Licencias estructuradas exigen numero, clases y fechas coherentes", () => {
    const license = { category: "DRIVER_LICENSE", title: "Licencia personal", details: "Declaracion de prueba", license: { number: "123456", issuer: "Entidad emisora", classes: ["B1"], issuedOn: "2020-01-01", expiresOn: "2030-01-01" } };
    (0, strict_1.default)(members_schemas_1.declarationSchema.safeParse(license).success);
    (0, strict_1.default)(!members_schemas_1.declarationSchema.safeParse({ ...license, license: undefined }).success);
    (0, strict_1.default)(!members_schemas_1.declarationSchema.safeParse({ ...license, license: { ...license.license, classes: ["B1", "b1"] } }).success);
    (0, strict_1.default)(!members_schemas_1.declarationSchema.safeParse({ ...license, license: { ...license.license, expiresOn: "2019-01-01" } }).success);
    (0, strict_1.default)(!members_schemas_1.declarationSchema.safeParse({ ...license, category: "CLOTHING" }).success);
});
(0, node_test_1.test)("Asistencia efectiva exige un solo servicio y no reemplaza una asignacion", () => {
    const body = { userId: "u", shiftId: "s", startedAt: "2026-01-01T09:00:00-03:00", endedAt: "2026-01-01T10:00:00-03:00", notes: "Asistencia efectivamente registrada" };
    (0, strict_1.default)(participation_service_1.participationSchema.safeParse(body).success);
    (0, strict_1.default)(!participation_service_1.participationSchema.safeParse({ ...body, incidentId: "i" }).success);
    (0, strict_1.default)(!participation_service_1.participationSchema.safeParse({ ...body, shiftId: undefined }).success);
    (0, strict_1.default)(!participation_service_1.participationSchema.safeParse({ ...body, endedAt: body.startedAt }).success);
});
(0, node_test_1.test)("Asistencias no admiten tiempos futuros ni fuera de los limites del servicio", () => {
    const start = new Date("2026-01-01T09:00:00Z"), end = new Date("2026-01-01T10:00:00Z"), now = new Date("2026-01-02T00:00:00Z");
    strict_1.default.doesNotThrow(() => (0, participation_service_1.validateParticipationInterval)(start, end, { start: start.getTime(), end: end.getTime() }, now));
    strict_1.default.throws(() => (0, participation_service_1.validateParticipationInterval)(start, end, { start: start.getTime() + 1, end: end.getTime() }, now));
    strict_1.default.throws(() => (0, participation_service_1.validateParticipationInterval)(start, end, { start: start.getTime(), end: end.getTime() - 1 }, now));
    strict_1.default.throws(() => (0, participation_service_1.validateParticipationInterval)(start, end, { start: start.getTime(), end: end.getTime() }, start));
});
(0, node_test_1.test)("Tipos de movil rechazan clasificaciones desconocidas", () => {
    (0, strict_1.default)(assets_schemas_1.upsertVehicleDataSchema.safeParse({ kind: "TANKER" }).success);
    (0, strict_1.default)(!assets_schemas_1.upsertVehicleDataSchema.safeParse({ kind: "INVALID" }).success);
    (0, strict_1.default)(assets_schemas_1.createAssetSchema.safeParse({ name: "Movil de prueba", assetType: "VEHICLE", lastCheckDate: "2026-01-01T00:00:00.000Z", vehicle: { unitNumber: "TEST", kind: "ENGINE" } }).success);
});
