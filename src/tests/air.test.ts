import test from "node:test";
import assert from "node:assert/strict";
import { airFillSchema, airHydroSchema, airPressureSchema, airCompressorSchema } from "../modules/air/air.schemas";
import { fillWindow, filterRemaining, hydroCurrent } from "../modules/air/air.rules";

test("ERA contabiliza minutos conservadores y admite cruce de medianoche", () => {
  assert.equal(fillWindow("2026-11-04T23:50:00-03:00", "2026-11-05T00:20:00-03:00", new Date("2026-11-05T04:00:00Z")).runMinutes, 30);
  assert.equal(fillWindow("2026-11-04T10:00:00Z", "2026-11-04T10:00:01Z", new Date("2026-11-05T04:00:00Z")).runMinutes, 1);
  for (const end of ["2026-11-04T09:59:00Z", "2026-11-04T10:00:00Z", "2026-11-06T12:00:00Z"]) assert.throws(() => fillWindow("2026-11-04T10:00:00Z", end, new Date("2026-11-05T04:00:00Z")));
});
test("El vencimiento hidraulico no se infiere ni una prueba rechazada habilita cargas", () => {
  const input = { revision: 1, notes: "Prueba documentada por taller", result: "PASS", testedOn: "2026-11-04", certificateReference: "CERT-01" };
  assert(!airHydroSchema.safeParse(input).success);
  assert(!airHydroSchema.safeParse({ ...input, validUntil: "2026-11-03" }).success);
  assert(airHydroSchema.safeParse({ ...input, validUntil: "2027-01-01" }).success);
  assert(!hydroCurrent({ result: "FAIL", validUntil: new Date("2027-01-01") }, "2026-11-05"));
  assert(!hydroCurrent(undefined, "2026-11-05"));
  assert(hydroCurrent({ result: "PASS", validUntil: new Date("2026-11-05") }, "2026-11-05"));
  assert(!hydroCurrent({ result: "PASS", validUntil: new Date("2026-11-04") }, "2026-11-05"));
});
test("Los cilindros vacios admiten cero bar y no presiones negativas", () => {
  assert(airPressureSchema.safeParse({ revision: 1, pressureBar: 0, notes: "Medicion de prueba sin presion" }).success);
  assert(!airPressureSchema.safeParse({ revision: 1, pressureBar: -1, notes: "Medicion de prueba invalida" }).success);
});
test("Las cargas rechazan cilindros y participantes duplicados", () => {
  const input = { operationKey: "550e8400-e29b-41d4-a716-446655440000", compressorId: "comp", revision: 1, startedAt: "2026-11-04T10:00:00Z", endedAt: "2026-11-04T11:00:00Z", operatorUserId: "operator", helperUserIds: [], reason: "TRAINING", notes: "Carga posterior a entrenamiento", items: [{ cylinderId: "tube", revision: 1, pressureBar: 200 }] };
  assert(airFillSchema.safeParse(input).success);
  assert(!airFillSchema.safeParse({ ...input, items: [...input.items, ...input.items] }).success);
  assert(!airFillSchema.safeParse({ ...input, helperUserIds: ["operator"] }).success);
  assert(!airFillSchema.safeParse({ ...input, helperUserIds: ["helper", "helper"] }).success);
});
test("El recuento del filtro no pierde las horas importadas y detecta agotamiento", () => {
  assert.equal(filterRemaining(120, 100, 30), 10);
  assert.equal(filterRemaining(130, 100, 30), 0);
  assert.equal(filterRemaining(140, 100, 30), 0);
  const input = { code: "COMP-01", name: "Compresor de prueba", maxPressureBar: 300, filterLifeMinutes: 60, filterReference: "MANUAL-01", filterInstalledAt: "2026-11-04T10:00:00Z", initialTotalMinutes: 10, initialFilterUsedMinutes: 11 };
  assert(!airCompressorSchema.safeParse(input).success);
});
