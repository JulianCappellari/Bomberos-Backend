"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const work_schemas_1 = require("../modules/work/work.schemas");
const fleet_schemas_1 = require("../modules/fleet/fleet.schemas");
const notebook_service_1 = require("../modules/work/notebook.service");
(0, node_test_1.test)("work lifecycle rejects bypasses and terminal changes", () => {
    for (const [from, to] of [["ASSIGNED", "SUBMITTED"], ["SUBMITTED", "VERIFIED"], ["SUBMITTED", "RETURNED"], ["RETURNED", "SUBMITTED"], ["ASSIGNED", "CANCELLED"]])
        strict_1.default.doesNotThrow(() => (0, work_schemas_1.assertWorkTransition)(from, to));
    for (const [from, to] of [["ASSIGNED", "VERIFIED"], ["VERIFIED", "SUBMITTED"], ["CANCELLED", "ASSIGNED"], ["SUBMITTED", "SUBMITTED"], ["RETURNED", "VERIFIED"]])
        strict_1.default.throws(() => (0, work_schemas_1.assertWorkTransition)(from, to));
});
(0, node_test_1.test)("task members must be unique and nonempty", () => {
    const body = { title: "Tarea ejemplo", description: "Descripcion completa", userIds: ["a"] };
    (0, strict_1.default)(work_schemas_1.createWorkSchema.safeParse(body).success);
    (0, strict_1.default)(work_schemas_1.createWorkSchema.safeParse({ ...body, userIds: [] }).success);
    (0, strict_1.default)(!work_schemas_1.createWorkSchema.safeParse({ ...body, userIds: ["a", "a"] }).success);
});
(0, node_test_1.test)("task evidence accepts only bounded HTTPS URLs without credentials", () => {
    const body = { revision: 1, notes: "Trabajo terminado", completedAt: new Date().toISOString(), evidenceUrls: ["https://example.org/evidencia"] };
    (0, strict_1.default)(work_schemas_1.submitWorkSchema.safeParse(body).success);
    for (const url of ["javascript:alert(1)", "http://example.org/x", "https://user:secret@example.org/x"])
        (0, strict_1.default)(!work_schemas_1.submitWorkSchema.safeParse({ ...body, evidenceUrls: [url] }).success);
    (0, strict_1.default)(!work_schemas_1.submitWorkSchema.safeParse({ ...body, evidenceUrls: Array(4).fill("https://example.org/x") }).success);
});
(0, node_test_1.test)("self reporting requires completion fields", () => {
    (0, strict_1.default)(!work_schemas_1.selfWorkSchema.safeParse({ title: "Trabajo ejemplo", description: "Trabajo realizado", userIds: ["a"] }).success);
});
(0, node_test_1.test)("transfer requires target but decline forbids it", () => {
    const base = { revision: 1, notes: "No puedo asistir" };
    (0, strict_1.default)(!work_schemas_1.memberWorkSchema.safeParse({ ...base, action: "TRANSFER" }).success);
    (0, strict_1.default)(!work_schemas_1.memberWorkSchema.safeParse({ ...base, action: "DECLINE", targetUserId: "a" }).success);
    (0, strict_1.default)(work_schemas_1.memberWorkSchema.safeParse({ ...base, action: "DECLINE" }).success);
});
(0, node_test_1.test)("future dates are rejected independently of client timezone", () => {
    const now = new Date("2026-11-05T12:00:00Z");
    strict_1.default.equal((0, work_schemas_1.assertPast)("2026-11-05T09:00:00-03:00", now).getTime(), now.getTime());
    strict_1.default.throws(() => (0, work_schemas_1.assertPast)("2026-11-05T12:00:01Z", now));
});
(0, node_test_1.test)("liters use exact milliliters with decimal comma or dot", () => {
    for (const [input, expected] of [["36.500", 36500], ["36,5", 36500], ["0.001", 1], ["100", 100000], ["1.010", 1010]])
        strict_1.default.equal((0, fleet_schemas_1.parseLiters)(input), expected);
    for (const input of ["", "0", "-1", "1e3", "1,000.5", "1.2345", "Infinity", "10001"])
        strict_1.default.equal((0, fleet_schemas_1.parseLiters)(input), null);
});
(0, node_test_1.test)("fuel requires positive liters and integer cents", () => {
    const body = { operationKey: "123e4567-e89b-42d3-a456-426614174000", assetId: "a", occurredAt: new Date().toISOString(), liters: "36,5", reason: "SERVICE" };
    strict_1.default.equal(fleet_schemas_1.fuelSchema.parse(body).liters, 36500);
    (0, strict_1.default)(!fleet_schemas_1.fuelSchema.safeParse({ ...body, costCents: 0.1 }).success);
    (0, strict_1.default)(!fleet_schemas_1.fuelSchema.safeParse({ ...body, liters: "0" }).success);
});
(0, node_test_1.test)("water trips require chronology, odometers, unique crew and leader", () => {
    const body = { operationKey: "123e4567-e89b-42d3-a456-426614174000", assetId: "a", customer: "Cliente ficticio", destination: "Predio ficticio", departedAt: "2026-11-01T10:00:00Z", returnedAt: "2026-11-01T11:00:00Z", startOdometer: 10, endOdometer: 20, tripCount: 1, chargeCents: 100, leaderUserId: "a", crew: [{ userId: "a", compensationCents: 10 }] };
    (0, strict_1.default)(fleet_schemas_1.waterSchema.safeParse(body).success);
    for (const delta of [{ returnedAt: body.departedAt }, { endOdometer: 9 }, { leaderUserId: "b" }, { crew: [...body.crew, ...body.crew] }, { chargeCents: -1 }, { tripCount: 0 }])
        (0, strict_1.default)(!fleet_schemas_1.waterSchema.safeParse({ ...body, ...delta }).success);
});
(0, node_test_1.test)("notebook rejects unknown categories and unbounded text", () => {
    const body = { category: "NOTE", title: "Registro prueba", body: "Detalle", occurredAt: new Date().toISOString() };
    (0, strict_1.default)(notebook_service_1.notebookSchema.safeParse(body).success);
    (0, strict_1.default)(!notebook_service_1.notebookSchema.safeParse({ ...body, category: "SECRET" }).success);
    (0, strict_1.default)(!notebook_service_1.notebookSchema.safeParse({ ...body, body: "x".repeat(4001) }).success);
});
