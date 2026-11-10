"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const inspections_rules_1 = require("../modules/inspections/inspections.rules");
const inspections_schemas_1 = require("../modules/inspections/inspections.schemas");
const shifts_schemas_1 = require("../modules/shifts/shifts.schemas");
const shifts_rules_1 = require("../modules/shifts/shifts.rules");
const public_user_1 = require("../utils/public-user");
(0, node_test_1.test)("La guardia nocturna dura doce horas y termina al dia siguiente", () => {
    const interval = (0, shifts_rules_1.shiftInterval)("2026-11-04", "20:00", "08:00");
    strict_1.default.equal(interval.end - interval.start, 12 * 60 * 60 * 1000);
});
(0, node_test_1.test)("Detecta solapamientos nocturnos entre dias distintos", () => {
    strict_1.default.equal((0, shifts_rules_1.shiftsOverlap)({ date: "2026-11-04", startTime: "20:00", endTime: "08:00" }, { date: "2026-11-05", startTime: "07:00", endTime: "12:00" }), true);
});
(0, node_test_1.test)("El relevo a las 08:00 no cuenta como solapamiento", () => {
    strict_1.default.equal((0, shifts_rules_1.shiftsOverlap)({ date: "2026-11-04", startTime: "20:00", endTime: "08:00" }, { date: "2026-11-05", startTime: "08:00", endTime: "20:00" }), false);
});
(0, node_test_1.test)("Guardias nocturnas consecutivas no se solapan", () => {
    strict_1.default.equal((0, shifts_rules_1.shiftsOverlap)({ date: "2026-11-04", startTime: "20:00", endTime: "08:00" }, { date: "2026-11-05", startTime: "20:00", endTime: "08:00" }), false);
});
(0, node_test_1.test)("Rechaza guardias sin personal y personas duplicadas", () => {
    const base = { date: "2026-11-04", period: "NIGHT" };
    strict_1.default.equal(shifts_schemas_1.createShiftSchema.safeParse({ ...base, assignedUserIds: [] }).success, false);
    strict_1.default.equal(shifts_schemas_1.createShiftSchema.safeParse({ ...base, assignedUserIds: ["u", "u"] }).success, false);
    strict_1.default.equal(shifts_schemas_1.createShiftSchema.safeParse({ ...base, assignedUserIds: ["u"] }).success, true);
});
(0, node_test_1.test)("Rechaza rangos de consulta invertidos", () => {
    strict_1.default.equal(shifts_schemas_1.listShiftsQuerySchema.safeParse({ from: "2026-11-05", to: "2026-11-04" }).success, false);
});
(0, node_test_1.test)("Material completo y en condiciones es valido", () => {
    strict_1.default.doesNotThrow(() => (0, inspections_rules_1.validateMaterial)({ result: "OK", observedQuantity: 2 }, 2));
});
(0, node_test_1.test)("Un material faltante no puede declararse OK", () => {
    strict_1.default.throws(() => (0, inspections_rules_1.validateMaterial)({ result: "OK", observedQuantity: 1 }, 2));
});
(0, node_test_1.test)("Faltantes y danos requieren una novedad", () => {
    strict_1.default.throws(() => (0, inspections_rules_1.validateMaterial)({ result: "MISSING", observedQuantity: 0 }, 1));
    strict_1.default.throws(() => (0, inspections_rules_1.validateMaterial)({ result: "DAMAGED", observedQuantity: 1, observations: " " }, 1));
});
(0, node_test_1.test)("Un material ausente no puede registrarse como danado", () => {
    strict_1.default.throws(() => (0, inspections_rules_1.validateMaterial)({ result: "DAMAGED", observedQuantity: 0, observations: "Novedad" }, 1));
});
(0, node_test_1.test)("El control valida hora y encargado dentro del equipo", () => {
    const base = {
        vehicleId: "v", inspectionDate: "2026-11-04", inspectionTime: "12:30",
        leaderUserId: "u", responsibleUserIds: ["u"],
        items: [{ inventoryItemId: "i", observedQuantity: 1, result: "OK", observations: null }],
        observations: null,
    };
    strict_1.default.equal(inspections_schemas_1.createInspectionSchema.safeParse(base).success, true);
    strict_1.default.equal(inspections_schemas_1.createInspectionSchema.safeParse({ ...base, inspectionTime: "25:99" }).success, false);
    strict_1.default.equal(inspections_schemas_1.createInspectionSchema.safeParse({ ...base, leaderUserId: "otro" }).success, false);
});
(0, node_test_1.test)("El cliente no puede reemplazar la cantidad esperada del inventario", () => {
    const value = inspections_schemas_1.createInspectionSchema.parse({
        vehicleId: "v", inspectionDate: "2026-11-04", inspectionTime: "12:30",
        leaderUserId: "u", responsibleUserIds: ["u"],
        items: [{ inventoryItemId: "i", observedQuantity: 1, expectedQuantity: 999, result: "OK" }],
    });
    strict_1.default.equal("expectedQuantity" in value.items[0], false);
});
(0, node_test_1.test)("Fechas de control usan el huso del cuartel", () => {
    strict_1.default.equal((0, inspections_rules_1.inspectionTimestamp)("2026-11-04", "23:30"), Date.parse("2026-11-05T02:30:00Z"));
});
(0, node_test_1.test)("Las consultas operativas seleccionan solo identidad publica", () => {
    strict_1.default.deepEqual(Object.keys(public_user_1.PUBLIC_USER_SELECT).sort(), ["id", "profile", "role", "username"]);
    strict_1.default.equal("dni" in public_user_1.PUBLIC_USER_SELECT.profile.select, false);
    strict_1.default.equal("passwordHash" in public_user_1.PUBLIC_USER_SELECT, false);
});
