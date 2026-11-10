import { test } from "node:test";
import assert from "node:assert/strict";
import { inspectionNotes } from "../modules/inspections/inspection-sections";
import { createInspectionSchema } from "../modules/inspections/inspections.schemas";
const sections = [{ id: "cab", name: "Cabina" }, { id: "rear", name: "Trasera" }];
test("Los comentarios conservan el nombre real de la seccion y el detalle", () => {
  assert.equal(inspectionNotes("General", [{ compartmentId: "cab", observations: "Falta material" }], sections), "General\n\nSeccion: Cabina\nFalta material");
  assert.equal(inspectionNotes(null, [], sections), null);
});
test("No acepta comentarios de otra baulera ni secciones duplicadas", () => {
  assert.throws(() => inspectionNotes(null, [{ compartmentId: "other", observations: "Detalle" }], sections));
  assert.throws(() => inspectionNotes(null, [{ compartmentId: "cab", observations: "A" }, { compartmentId: "cab", observations: "B" }], sections));
});
test("Las observaciones combinadas no exceden el limite de almacenamiento", () => {
  assert.throws(() => inspectionNotes("x".repeat(9999), [{ compartmentId: "cab", observations: "Detalle" }], sections));
});
test("El formulario limita la cantidad y longitud de comentarios", () => {
  const base = { vehicleId: "v", inspectionDate: "2026-01-01", inspectionTime: "12:00", leaderUserId: "u", responsibleUserIds: ["u"], items: [{ inventoryItemId: "i", observedQuantity: 1, result: "OK" }] };
  assert(createInspectionSchema.safeParse(base).success);
  assert(!createInspectionSchema.safeParse({ ...base, sectionComments: [{ compartmentId: "cab", observations: "x".repeat(2001) }] }).success);
});
