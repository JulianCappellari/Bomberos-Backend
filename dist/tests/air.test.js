"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const air_schemas_1 = require("../modules/air/air.schemas");
const air_rules_1 = require("../modules/air/air.rules");
(0, node_test_1.default)("ERA contabiliza minutos conservadores y admite cruce de medianoche", () => {
    strict_1.default.equal((0, air_rules_1.fillWindow)("2026-11-04T23:50:00-03:00", "2026-11-05T00:20:00-03:00", new Date("2026-11-05T04:00:00Z")).runMinutes, 30);
    strict_1.default.equal((0, air_rules_1.fillWindow)("2026-11-04T10:00:00Z", "2026-11-04T10:00:01Z", new Date("2026-11-05T04:00:00Z")).runMinutes, 1);
    for (const end of ["2026-11-04T09:59:00Z", "2026-11-04T10:00:00Z", "2026-11-06T12:00:00Z"])
        strict_1.default.throws(() => (0, air_rules_1.fillWindow)("2026-11-04T10:00:00Z", end, new Date("2026-11-05T04:00:00Z")));
});
(0, node_test_1.default)("El vencimiento hidraulico no se infiere ni una prueba rechazada habilita cargas", () => {
    const input = { revision: 1, notes: "Prueba documentada por taller", result: "PASS", testedOn: "2026-11-04", certificateReference: "CERT-01" };
    (0, strict_1.default)(!air_schemas_1.airHydroSchema.safeParse(input).success);
    (0, strict_1.default)(!air_schemas_1.airHydroSchema.safeParse({ ...input, validUntil: "2026-11-03" }).success);
    (0, strict_1.default)(air_schemas_1.airHydroSchema.safeParse({ ...input, validUntil: "2027-01-01" }).success);
    (0, strict_1.default)(!(0, air_rules_1.hydroCurrent)({ result: "FAIL", validUntil: new Date("2027-01-01") }, "2026-11-05"));
    (0, strict_1.default)(!(0, air_rules_1.hydroCurrent)(undefined, "2026-11-05"));
    (0, strict_1.default)((0, air_rules_1.hydroCurrent)({ result: "PASS", validUntil: new Date("2026-11-05") }, "2026-11-05"));
    (0, strict_1.default)(!(0, air_rules_1.hydroCurrent)({ result: "PASS", validUntil: new Date("2026-11-04") }, "2026-11-05"));
});
(0, node_test_1.default)("Los cilindros vacios admiten cero bar y no presiones negativas", () => {
    (0, strict_1.default)(air_schemas_1.airPressureSchema.safeParse({ revision: 1, pressureBar: 0, notes: "Medicion de prueba sin presion" }).success);
    (0, strict_1.default)(!air_schemas_1.airPressureSchema.safeParse({ revision: 1, pressureBar: -1, notes: "Medicion de prueba invalida" }).success);
});
(0, node_test_1.default)("Las cargas rechazan cilindros y participantes duplicados", () => {
    const input = { operationKey: "550e8400-e29b-41d4-a716-446655440000", compressorId: "comp", revision: 1, startedAt: "2026-11-04T10:00:00Z", endedAt: "2026-11-04T11:00:00Z", operatorUserId: "operator", helperUserIds: [], reason: "TRAINING", notes: "Carga posterior a entrenamiento", items: [{ cylinderId: "tube", revision: 1, pressureBar: 200 }] };
    (0, strict_1.default)(air_schemas_1.airFillSchema.safeParse(input).success);
    (0, strict_1.default)(!air_schemas_1.airFillSchema.safeParse({ ...input, items: [...input.items, ...input.items] }).success);
    (0, strict_1.default)(!air_schemas_1.airFillSchema.safeParse({ ...input, helperUserIds: ["operator"] }).success);
    (0, strict_1.default)(!air_schemas_1.airFillSchema.safeParse({ ...input, helperUserIds: ["helper", "helper"] }).success);
});
(0, node_test_1.default)("El recuento del filtro no pierde las horas importadas y detecta agotamiento", () => {
    strict_1.default.equal((0, air_rules_1.filterRemaining)(120, 100, 30), 10);
    strict_1.default.equal((0, air_rules_1.filterRemaining)(130, 100, 30), 0);
    strict_1.default.equal((0, air_rules_1.filterRemaining)(140, 100, 30), 0);
    const input = { code: "COMP-01", name: "Compresor de prueba", maxPressureBar: 300, filterLifeMinutes: 60, filterReference: "MANUAL-01", filterInstalledAt: "2026-11-04T10:00:00Z", initialTotalMinutes: 10, initialFilterUsedMinutes: 11 };
    (0, strict_1.default)(!air_schemas_1.airCompressorSchema.safeParse(input).success);
});
