"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const reports_service_1 = require("../modules/operations/reports.service");
(0, node_test_1.test)("El reporte mensual usa medianoche del cuartel y limite final exclusivo", () => {
    const bounds = (0, reports_service_1.reportBounds)("2026-11");
    strict_1.default.equal(bounds.start.toISOString(), "2026-11-01T03:00:00.000Z");
    strict_1.default.equal(bounds.end.toISOString(), "2026-12-01T03:00:00.000Z");
});
(0, node_test_1.test)("Una permanencia que cruza de mes solo aporta la parte del mes consultado", () => {
    const { start, end } = (0, reports_service_1.reportBounds)("2026-11");
    const duration = (0, reports_service_1.sessionMilliseconds)(new Date("2026-11-01T02:00:00Z"), new Date("2026-11-01T04:00:00Z"), start, end);
    strict_1.default.equal(duration, 3600000);
});
(0, node_test_1.test)("Una sesion fuera de mes o con fechas invertidas no agrega horas", () => {
    const { start, end } = (0, reports_service_1.reportBounds)("2026-11");
    strict_1.default.equal((0, reports_service_1.sessionMilliseconds)(new Date("2026-10-01"), new Date("2026-10-02"), start, end), 0);
    strict_1.default.equal((0, reports_service_1.sessionMilliseconds)(new Date("2026-11-05"), new Date("2026-11-04"), start, end), 0);
});
(0, node_test_1.test)("Diciembre calcula correctamente el cambio de anio", () => {
    strict_1.default.equal((0, reports_service_1.reportBounds)("2026-12").end.toISOString(), "2027-01-01T03:00:00.000Z");
    strict_1.default.equal(reports_service_1.monthlyReportQuerySchema.safeParse({ month: "2026-13" }).success, false);
});
(0, node_test_1.test)("Registros duplicados o solapados no duplican las horas", () => {
    strict_1.default.equal((0, reports_service_1.unionMilliseconds)([{ start: 0, end: 60000 }, { start: 30000, end: 90000 }, { start: 0, end: 60000 }]), 90000);
});
