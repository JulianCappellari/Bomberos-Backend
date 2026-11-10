import test from "node:test";
import assert from "node:assert/strict";
import { createPersonalEquipmentSchema, issueEquipmentSchema, returnEquipmentSchema, checkEquipmentSchema, equipmentListSchema } from "../modules/personal-equipment/personal-equipment.schemas";
import { createEquipmentRequestSchema, reviewEquipmentRequestSchema } from "../modules/personal-equipment/equipment-requests.schemas";
test("Equipamiento personal normaliza codigo y rechaza HTML en identificadores", () => {
  const item = { code: " casco-01 ", name: "Casco estructural", category: "HELMET" };
  assert.equal(createPersonalEquipmentSchema.parse(item).code, "CASCO-01");
  assert(!createPersonalEquipmentSchema.safeParse({ ...item, code: "<script>" }).success);
  assert(!createPersonalEquipmentSchema.safeParse({ ...item, category: "UNKNOWN" }).success);
});
test("Las novedades de devolucion requieren una descripcion y una entrega concreta", () => {
  const input = { revision: 1, issueId: "issue", condition: "OK", notes: "" };
  assert(returnEquipmentSchema.safeParse(input).success);
  assert(!returnEquipmentSchema.safeParse({ ...input, condition: "REVIEW" }).success);
  assert(!returnEquipmentSchema.safeParse({ ...input, condition: "OUT" }).success);
  assert(returnEquipmentSchema.safeParse({ ...input, condition: "OUT", notes: "Se recibio con una rotura visible" }).success);
  assert(!returnEquipmentSchema.safeParse({ ...input, issueId: "" }).success);
});
test("Una revision exige detalle y las acciones rechazan versiones invalidas", () => {
  assert(!checkEquipmentSchema.safeParse({ revision: 1, condition: "OK", notes: "" }).success);
  for (const revision of [0, -1, 1.5, 2147483647]) assert(!issueEquipmentSchema.safeParse({ revision, userId: "person" }).success);
  assert(!equipmentListSchema.safeParse({ page: "-1" }).success);
  assert(!equipmentListSchema.safeParse({ view: "unvalidated" }).success);
});
test("Los pedidos exigen motivo y la entrega vinculada exige revision del pedido", () => {
  assert(!createEquipmentRequestSchema.safeParse({ category: "HELMET", reason: "" }).success);
  assert(!reviewEquipmentRequestSchema.safeParse({ revision: 1, status: "FULFILLED", notes: "No es una entrega fisica" }).success);
  assert(!issueEquipmentSchema.safeParse({ revision: 1, userId: "person", requestId: "request" }).success);
  assert(!issueEquipmentSchema.safeParse({ revision: 1, userId: "person", requestRevision: 1 }).success);
  assert(issueEquipmentSchema.safeParse({ revision: 1, userId: "person", requestId: "request", requestRevision: 1 }).success);
});
