"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const inspection_sections_1 = require("../modules/inspections/inspection-sections");
const inspections_schemas_1 = require("../modules/inspections/inspections.schemas");
const sections = [{ id: "cab", name: "Cabina" }, { id: "rear", name: "Trasera" }];
(0, node_test_1.test)("Los comentarios conservan el nombre real de la seccion y el detalle", () => {
    strict_1.default.equal((0, inspection_sections_1.inspectionNotes)("General", [{ compartmentId: "cab", observations: "Falta material" }], sections), "General\n\nSeccion: Cabina\nFalta material");
    strict_1.default.equal((0, inspection_sections_1.inspectionNotes)(null, [], sections), null);
});
(0, node_test_1.test)("No acepta comentarios de otra baulera ni secciones duplicadas", () => {
    strict_1.default.throws(() => (0, inspection_sections_1.inspectionNotes)(null, [{ compartmentId: "other", observations: "Detalle" }], sections));
    strict_1.default.throws(() => (0, inspection_sections_1.inspectionNotes)(null, [{ compartmentId: "cab", observations: "A" }, { compartmentId: "cab", observations: "B" }], sections));
});
(0, node_test_1.test)("Las observaciones combinadas no exceden el limite de almacenamiento", () => {
    strict_1.default.throws(() => (0, inspection_sections_1.inspectionNotes)("x".repeat(9999), [{ compartmentId: "cab", observations: "Detalle" }], sections));
});
(0, node_test_1.test)("El formulario limita la cantidad y longitud de comentarios", () => {
    const base = { vehicleId: "v", inspectionDate: "2026-01-01", inspectionTime: "12:00", leaderUserId: "u", responsibleUserIds: ["u"], items: [{ inventoryItemId: "i", observedQuantity: 1, result: "OK" }] };
    (0, strict_1.default)(inspections_schemas_1.createInspectionSchema.safeParse(base).success);
    (0, strict_1.default)(!inspections_schemas_1.createInspectionSchema.safeParse({ ...base, sectionComments: [{ compartmentId: "cab", observations: "x".repeat(2001) }] }).success);
});
