"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const personal_equipment_schemas_1 = require("../modules/personal-equipment/personal-equipment.schemas");
const equipment_requests_schemas_1 = require("../modules/personal-equipment/equipment-requests.schemas");
(0, node_test_1.default)("Equipamiento personal normaliza codigo y rechaza HTML en identificadores", () => {
    const item = { code: " casco-01 ", name: "Casco estructural", category: "HELMET" };
    strict_1.default.equal(personal_equipment_schemas_1.createPersonalEquipmentSchema.parse(item).code, "CASCO-01");
    (0, strict_1.default)(!personal_equipment_schemas_1.createPersonalEquipmentSchema.safeParse({ ...item, code: "<script>" }).success);
    (0, strict_1.default)(!personal_equipment_schemas_1.createPersonalEquipmentSchema.safeParse({ ...item, category: "UNKNOWN" }).success);
});
(0, node_test_1.default)("Las novedades de devolucion requieren una descripcion y una entrega concreta", () => {
    const input = { revision: 1, issueId: "issue", condition: "OK", notes: "" };
    (0, strict_1.default)(personal_equipment_schemas_1.returnEquipmentSchema.safeParse(input).success);
    (0, strict_1.default)(!personal_equipment_schemas_1.returnEquipmentSchema.safeParse({ ...input, condition: "REVIEW" }).success);
    (0, strict_1.default)(!personal_equipment_schemas_1.returnEquipmentSchema.safeParse({ ...input, condition: "OUT" }).success);
    (0, strict_1.default)(personal_equipment_schemas_1.returnEquipmentSchema.safeParse({ ...input, condition: "OUT", notes: "Se recibio con una rotura visible" }).success);
    (0, strict_1.default)(!personal_equipment_schemas_1.returnEquipmentSchema.safeParse({ ...input, issueId: "" }).success);
});
(0, node_test_1.default)("Una revision exige detalle y las acciones rechazan versiones invalidas", () => {
    (0, strict_1.default)(!personal_equipment_schemas_1.checkEquipmentSchema.safeParse({ revision: 1, condition: "OK", notes: "" }).success);
    for (const revision of [0, -1, 1.5, 2147483647])
        (0, strict_1.default)(!personal_equipment_schemas_1.issueEquipmentSchema.safeParse({ revision, userId: "person" }).success);
    (0, strict_1.default)(!personal_equipment_schemas_1.equipmentListSchema.safeParse({ page: "-1" }).success);
    (0, strict_1.default)(!personal_equipment_schemas_1.equipmentListSchema.safeParse({ view: "unvalidated" }).success);
});
(0, node_test_1.default)("Los pedidos exigen motivo y la entrega vinculada exige revision del pedido", () => {
    (0, strict_1.default)(!equipment_requests_schemas_1.createEquipmentRequestSchema.safeParse({ category: "HELMET", reason: "" }).success);
    (0, strict_1.default)(!equipment_requests_schemas_1.reviewEquipmentRequestSchema.safeParse({ revision: 1, status: "FULFILLED", notes: "No es una entrega fisica" }).success);
    (0, strict_1.default)(!personal_equipment_schemas_1.issueEquipmentSchema.safeParse({ revision: 1, userId: "person", requestId: "request" }).success);
    (0, strict_1.default)(!personal_equipment_schemas_1.issueEquipmentSchema.safeParse({ revision: 1, userId: "person", requestRevision: 1 }).success);
    (0, strict_1.default)(personal_equipment_schemas_1.issueEquipmentSchema.safeParse({ revision: 1, userId: "person", requestId: "request", requestRevision: 1 }).success);
});
