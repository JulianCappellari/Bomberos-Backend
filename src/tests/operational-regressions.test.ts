import assert from "node:assert/strict";
import { test } from "node:test";
import { validateMaterial, inspectionTimestamp } from "../modules/inspections/inspections.rules";
import { createInspectionSchema } from "../modules/inspections/inspections.schemas";
import { createShiftSchema, listShiftsQuerySchema } from "../modules/shifts/shifts.schemas";
import { shiftsOverlap, shiftInterval } from "../modules/shifts/shifts.rules";
import { PUBLIC_USER_SELECT } from "../utils/public-user";

test("La guardia nocturna dura doce horas y termina al dia siguiente", () => {
  const interval = shiftInterval("2026-11-04", "20:00", "08:00");
  assert.equal(interval.end - interval.start, 12 * 60 * 60 * 1000);
});

test("Detecta solapamientos nocturnos entre dias distintos", () => {
  assert.equal(shiftsOverlap(
    { date: "2026-11-04", startTime: "20:00", endTime: "08:00" },
    { date: "2026-11-05", startTime: "07:00", endTime: "12:00" },
  ), true);
});

test("El relevo a las 08:00 no cuenta como solapamiento", () => {
  assert.equal(shiftsOverlap(
    { date: "2026-11-04", startTime: "20:00", endTime: "08:00" },
    { date: "2026-11-05", startTime: "08:00", endTime: "20:00" },
  ), false);
});

test("Guardias nocturnas consecutivas no se solapan", () => {
  assert.equal(shiftsOverlap(
    { date: "2026-11-04", startTime: "20:00", endTime: "08:00" },
    { date: "2026-11-05", startTime: "20:00", endTime: "08:00" },
  ), false);
});

test("Rechaza guardias sin personal y personas duplicadas", () => {
  const base = { date: "2026-11-04", period: "NIGHT" };
  assert.equal(createShiftSchema.safeParse({ ...base, assignedUserIds: [] }).success, false);
  assert.equal(createShiftSchema.safeParse({ ...base, assignedUserIds: ["u", "u"] }).success, false);
  assert.equal(createShiftSchema.safeParse({ ...base, assignedUserIds: ["u"] }).success, true);
});

test("Rechaza rangos de consulta invertidos", () => {
  assert.equal(listShiftsQuerySchema.safeParse({ from: "2026-11-05", to: "2026-11-04" }).success, false);
});

test("Material completo y en condiciones es valido", () => {
  assert.doesNotThrow(() => validateMaterial({ result: "OK", observedQuantity: 2 }, 2));
});

test("Un material faltante no puede declararse OK", () => {
  assert.throws(() => validateMaterial({ result: "OK", observedQuantity: 1 }, 2));
});

test("Faltantes y danos requieren una novedad", () => {
  assert.throws(() => validateMaterial({ result: "MISSING", observedQuantity: 0 }, 1));
  assert.throws(() => validateMaterial({ result: "DAMAGED", observedQuantity: 1, observations: " " }, 1));
});

test("Un material ausente no puede registrarse como danado", () => {
  assert.throws(() => validateMaterial({ result: "DAMAGED", observedQuantity: 0, observations: "Novedad" }, 1));
});

test("El control valida hora y encargado dentro del equipo", () => {
  const base = {
    vehicleId: "v", inspectionDate: "2026-11-04", inspectionTime: "12:30",
    leaderUserId: "u", responsibleUserIds: ["u"],
    items: [{ inventoryItemId: "i", observedQuantity: 1, result: "OK", observations: null }],
    observations: null,
  };
  assert.equal(createInspectionSchema.safeParse(base).success, true);
  assert.equal(createInspectionSchema.safeParse({ ...base, inspectionTime: "25:99" }).success, false);
  assert.equal(createInspectionSchema.safeParse({ ...base, leaderUserId: "otro" }).success, false);
});

test("El cliente no puede reemplazar la cantidad esperada del inventario", () => {
  const value = createInspectionSchema.parse({
    vehicleId: "v", inspectionDate: "2026-11-04", inspectionTime: "12:30",
    leaderUserId: "u", responsibleUserIds: ["u"],
    items: [{ inventoryItemId: "i", observedQuantity: 1, expectedQuantity: 999, result: "OK" }],
  });
  assert.equal("expectedQuantity" in value.items[0], false);
});

test("Fechas de control usan el huso del cuartel", () => {
  assert.equal(inspectionTimestamp("2026-11-04", "23:30"), Date.parse("2026-11-05T02:30:00Z"));
});

test("Las consultas operativas seleccionan solo identidad publica", () => {
  assert.deepEqual(Object.keys(PUBLIC_USER_SELECT).sort(), ["id", "profile", "role", "username"]);
  assert.equal("dni" in PUBLIC_USER_SELECT.profile.select, false);
  assert.equal("passwordHash" in PUBLIC_USER_SELECT, false);
});
