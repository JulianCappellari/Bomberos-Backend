import assert from "node:assert/strict";
import { test } from "node:test";
import { declarationSchema } from "../modules/members/members.schemas";
import { participationSchema, validateParticipationInterval } from "../modules/members/participation.service";
import { createAssetSchema, upsertVehicleDataSchema } from "../modules/assets/assets.schemas";
import { createAlertSchema } from "../modules/alerts/alerts.schemas";
test("La emisión de alertas exige ubicación, prioridad, tipo y descripción", () => {
  const alert = { type: "OTHER", priority: "HIGH", location: "Calle de prueba", description: "Emergencia declarada" };
  assert(createAlertSchema.safeParse(alert).success);
  assert(!createAlertSchema.safeParse({ ...alert, description: "   " }).success);
  assert(!createAlertSchema.safeParse({ ...alert, description: undefined }).success);
  assert(!createAlertSchema.safeParse({ ...alert, location: "" }).success);
});
test("Licencias estructuradas exigen numero, clases y fechas coherentes", () => {
  const license = { category: "DRIVER_LICENSE", title: "Licencia personal", details: "Declaracion de prueba", license: { number: "123456", issuer: "Entidad emisora", classes: ["B1"], issuedOn: "2020-01-01", expiresOn: "2030-01-01" } };
  assert(declarationSchema.safeParse(license).success);
  assert(!declarationSchema.safeParse({ ...license, license: undefined }).success);
  assert(!declarationSchema.safeParse({ ...license, license: { ...license.license, classes: ["B1", "b1"] } }).success);
  assert(!declarationSchema.safeParse({ ...license, license: { ...license.license, expiresOn: "2019-01-01" } }).success);
  assert(!declarationSchema.safeParse({ ...license, category: "CLOTHING" }).success);
});
test("Asistencia efectiva exige un solo servicio y no reemplaza una asignacion", () => {
  const body = { userId: "u", shiftId: "s", startedAt: "2026-01-01T09:00:00-03:00", endedAt: "2026-01-01T10:00:00-03:00", notes: "Asistencia efectivamente registrada" };
  assert(participationSchema.safeParse(body).success);
  assert(!participationSchema.safeParse({ ...body, incidentId: "i" }).success);
  assert(!participationSchema.safeParse({ ...body, shiftId: undefined }).success);
  assert(!participationSchema.safeParse({ ...body, endedAt: body.startedAt }).success);
});
test("Asistencias no admiten tiempos futuros ni fuera de los limites del servicio", () => {
  const start = new Date("2026-01-01T09:00:00Z"), end = new Date("2026-01-01T10:00:00Z"), now = new Date("2026-01-02T00:00:00Z");
  assert.doesNotThrow(() => validateParticipationInterval(start, end, { start: start.getTime(), end: end.getTime() }, now));
  assert.throws(() => validateParticipationInterval(start, end, { start: start.getTime() + 1, end: end.getTime() }, now));
  assert.throws(() => validateParticipationInterval(start, end, { start: start.getTime(), end: end.getTime() - 1 }, now));
  assert.throws(() => validateParticipationInterval(start, end, { start: start.getTime(), end: end.getTime() }, start));
});
test("Tipos de movil rechazan clasificaciones desconocidas", () => {
  assert(upsertVehicleDataSchema.safeParse({ kind: "TANKER" }).success);
  assert(!upsertVehicleDataSchema.safeParse({ kind: "INVALID" }).success);
  assert(createAssetSchema.safeParse({ name: "Movil de prueba", assetType: "VEHICLE", lastCheckDate: "2026-01-01T00:00:00.000Z", vehicle: { unitNumber: "TEST", kind: "ENGINE" } }).success);
});
