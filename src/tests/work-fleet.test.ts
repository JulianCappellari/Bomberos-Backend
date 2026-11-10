import { test } from "node:test";
import assert from "node:assert/strict";
import { assertPast, assertWorkTransition, createWorkSchema, memberWorkSchema, selfWorkSchema, submitWorkSchema } from "../modules/work/work.schemas";
import { fuelSchema, parseLiters, waterSchema } from "../modules/fleet/fleet.schemas";
import { notebookSchema } from "../modules/work/notebook.service";

test("work lifecycle rejects bypasses and terminal changes", () => {
  for (const [from, to] of [["ASSIGNED", "SUBMITTED"], ["SUBMITTED", "VERIFIED"], ["SUBMITTED", "RETURNED"], ["RETURNED", "SUBMITTED"], ["ASSIGNED", "CANCELLED"]]) assert.doesNotThrow(() => assertWorkTransition(from!, to!));
  for (const [from, to] of [["ASSIGNED", "VERIFIED"], ["VERIFIED", "SUBMITTED"], ["CANCELLED", "ASSIGNED"], ["SUBMITTED", "SUBMITTED"], ["RETURNED", "VERIFIED"]]) assert.throws(() => assertWorkTransition(from!, to!));
});
test("task members must be unique and nonempty", () => {
  const body = { title: "Tarea ejemplo", description: "Descripcion completa", userIds: ["a"] };
  assert(createWorkSchema.safeParse(body).success);
  assert(createWorkSchema.safeParse({ ...body, userIds: [] }).success);
  assert(!createWorkSchema.safeParse({ ...body, userIds: ["a", "a"] }).success);
});
test("task evidence accepts only bounded HTTPS URLs without credentials", () => {
  const body = { revision: 1, notes: "Trabajo terminado", completedAt: new Date().toISOString(), evidenceUrls: ["https://example.org/evidencia"] };
  assert(submitWorkSchema.safeParse(body).success);
  for (const url of ["javascript:alert(1)", "http://example.org/x", "https://user:secret@example.org/x"]) assert(!submitWorkSchema.safeParse({ ...body, evidenceUrls: [url] }).success);
  assert(!submitWorkSchema.safeParse({ ...body, evidenceUrls: Array(4).fill("https://example.org/x") }).success);
});
test("self reporting requires completion fields", () => {
  assert(!selfWorkSchema.safeParse({ title: "Trabajo ejemplo", description: "Trabajo realizado", userIds: ["a"] }).success);
});
test("transfer requires target but decline forbids it", () => {
  const base = { revision: 1, notes: "No puedo asistir" };
  assert(!memberWorkSchema.safeParse({ ...base, action: "TRANSFER" }).success);
  assert(!memberWorkSchema.safeParse({ ...base, action: "DECLINE", targetUserId: "a" }).success);
  assert(memberWorkSchema.safeParse({ ...base, action: "DECLINE" }).success);
});
test("future dates are rejected independently of client timezone", () => {
  const now = new Date("2026-11-05T12:00:00Z");
  assert.equal(assertPast("2026-11-05T09:00:00-03:00", now).getTime(), now.getTime());
  assert.throws(() => assertPast("2026-11-05T12:00:01Z", now));
});
test("liters use exact milliliters with decimal comma or dot", () => {
  for (const [input, expected] of [["36.500", 36500], ["36,5", 36500], ["0.001", 1], ["100", 100000], ["1.010", 1010]] as const) assert.equal(parseLiters(input), expected);
  for (const input of ["", "0", "-1", "1e3", "1,000.5", "1.2345", "Infinity", "10001"]) assert.equal(parseLiters(input), null);
});
test("fuel requires positive liters and integer cents", () => {
  const body = { operationKey: "123e4567-e89b-42d3-a456-426614174000", assetId: "a", occurredAt: new Date().toISOString(), liters: "36,5", reason: "SERVICE" };
  assert.equal(fuelSchema.parse(body).liters, 36500);
  assert(!fuelSchema.safeParse({ ...body, costCents: 0.1 }).success);
  assert(!fuelSchema.safeParse({ ...body, liters: "0" }).success);
});
test("water trips require chronology, odometers, unique crew and leader", () => {
  const body = { operationKey: "123e4567-e89b-42d3-a456-426614174000", assetId: "a", customer: "Cliente ficticio", destination: "Predio ficticio", departedAt: "2026-11-01T10:00:00Z", returnedAt: "2026-11-01T11:00:00Z", startOdometer: 10, endOdometer: 20, tripCount: 1, chargeCents: 100, leaderUserId: "a", crew: [{ userId: "a", compensationCents: 10 }] };
  assert(waterSchema.safeParse(body).success);
  for (const delta of [{ returnedAt: body.departedAt }, { endOdometer: 9 }, { leaderUserId: "b" }, { crew: [...body.crew, ...body.crew] }, { chargeCents: -1 }, { tripCount: 0 }]) assert(!waterSchema.safeParse({ ...body, ...delta }).success);
});
test("notebook rejects unknown categories and unbounded text", () => {
  const body = { category: "NOTE", title: "Registro prueba", body: "Detalle", occurredAt: new Date().toISOString() };
  assert(notebookSchema.safeParse(body).success);
  assert(!notebookSchema.safeParse({ ...body, category: "SECRET" }).success);
  assert(!notebookSchema.safeParse({ ...body, body: "x".repeat(4001) }).success);
});
