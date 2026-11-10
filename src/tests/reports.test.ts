import assert from "node:assert/strict";
import { test } from "node:test";
import { reportBounds, sessionMilliseconds, unionMilliseconds, monthlyReportQuerySchema } from "../modules/operations/reports.service";

test("El reporte mensual usa medianoche del cuartel y limite final exclusivo", () => {
  const bounds = reportBounds("2026-11");
  assert.equal(bounds.start.toISOString(), "2026-11-01T03:00:00.000Z");
  assert.equal(bounds.end.toISOString(), "2026-12-01T03:00:00.000Z");
});
test("Una permanencia que cruza de mes solo aporta la parte del mes consultado", () => {
  const { start, end } = reportBounds("2026-11");
  const duration = sessionMilliseconds(new Date("2026-11-01T02:00:00Z"), new Date("2026-11-01T04:00:00Z"), start, end);
  assert.equal(duration, 3600000);
});
test("Una sesion fuera de mes o con fechas invertidas no agrega horas", () => {
  const { start, end } = reportBounds("2026-11");
  assert.equal(sessionMilliseconds(new Date("2026-10-01"), new Date("2026-10-02"), start, end), 0);
  assert.equal(sessionMilliseconds(new Date("2026-11-05"), new Date("2026-11-04"), start, end), 0);
});
test("Diciembre calcula correctamente el cambio de anio", () => {
  assert.equal(reportBounds("2026-12").end.toISOString(), "2027-01-01T03:00:00.000Z");
  assert.equal(monthlyReportQuerySchema.safeParse({ month: "2026-13" }).success, false);
});
test("Registros duplicados o solapados no duplican las horas", () => {
  assert.equal(unionMilliseconds([{ start: 0, end: 60000 }, { start: 30000, end: 90000 }, { start: 0, end: 60000 }]), 90000);
});
