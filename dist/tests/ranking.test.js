"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const ranking_rules_1 = require("../modules/ranking/ranking.rules");
(0, node_test_1.default)("L07: repetir el control de un movil suma solo en dias distintos", () => { const rows = [{ vehicleId: "a", inspectionDate: new Date("2026-10-30") }, { vehicleId: "a", inspectionDate: new Date("2026-11-01") }, { vehicleId: "a", inspectionDate: new Date("2026-11-02") }, { vehicleId: "a", inspectionDate: new Date("2026-11-02") }, { vehicleId: "b", inspectionDate: new Date("2026-11-02") }, { vehicleId: "a", inspectionDate: new Date("2026-11-03") }]; strict_1.default.equal((0, ranking_rules_1.creditedControls)(rows, "2026-10"), 1); strict_1.default.equal((0, ranking_rules_1.creditedControls)(rows, "2026-11"), 4); });
(0, node_test_1.default)("ranking subtracts paid guard intervals and deployments without double counting", () => {
    const hour = 3600000;
    strict_1.default.equal((0, ranking_rules_1.unpaidMinutes)([{ start: 0, end: 10 * hour }, { start: hour, end: 8 * hour }], [{ start: 0, end: 8 * hour }, { start: 7 * hour, end: 9 * hour }]), 60);
    strict_1.default.equal((0, ranking_rules_1.unpaidMinutes)([{ start: 0, end: 8 * hour }], [{ start: 0, end: 8 * hour }]), 0);
    strict_1.default.equal((0, ranking_rules_1.unpaidMinutes)([{ start: 0, end: hour }], [{ start: 2 * hour, end: 3 * hour }]), 60);
});
(0, node_test_1.default)("one penalty per overdue task; pending verification and justified cancellation are not failures", () => {
    const task = { dueOn: new Date("2026-11-04"), createdAt: new Date("2026-11-01"), status: "ASSIGNED", completedAt: null };
    (0, strict_1.default)((0, ranking_rules_1.overdue)(task, "2026-11-05"));
    (0, strict_1.default)(!(0, ranking_rules_1.overdue)(task, "2026-11-04"));
    (0, strict_1.default)(!(0, ranking_rules_1.overdue)({ ...task, status: "SUBMITTED" }, "2026-11-05"));
    (0, strict_1.default)(!(0, ranking_rules_1.overdue)({ ...task, status: "CANCELLED" }, "2026-11-05"));
    (0, strict_1.default)((0, ranking_rules_1.overdue)({ ...task, status: "VERIFIED", completedAt: new Date("2026-11-05T04:00:00Z") }, "2026-11-05"));
    (0, strict_1.default)(!(0, ranking_rules_1.overdue)({ ...task, createdAt: new Date("2026-11-06") }, "2026-11-09"));
});
(0, node_test_1.default)("ranking weights cannot be negative or arbitrary extra fields", () => { (0, strict_1.default)(ranking_rules_1.policySchema.safeParse(ranking_rules_1.defaults).success); (0, strict_1.default)(!ranking_rules_1.policySchema.safeParse({ ...ranking_rules_1.defaults, missedTask: -1 }).success); });
