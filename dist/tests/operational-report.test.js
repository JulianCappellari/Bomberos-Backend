"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const operational_report_1 = require("../modules/operations/operational-report");
(0, node_test_1.default)("Los tiempos faltantes no se convierten en cero y la cronología invertida queda excluida", () => {
    const at = new Date("2026-11-09T10:00:00Z"), later = new Date(+at + 90000);
    strict_1.default.equal((0, operational_report_1.measuredMinutes)(at, later), 1.5);
    strict_1.default.equal((0, operational_report_1.measuredMinutes)(later, at), null);
    strict_1.default.equal((0, operational_report_1.measuredMinutes)(null, later), null);
    strict_1.default.deepEqual((0, operational_report_1.meanSample)([null, 2, 4]), { minutes: 3, samples: 2, missing: 1 });
    strict_1.default.deepEqual((0, operational_report_1.meanSample)([null]), { minutes: null, samples: 0, missing: 1 });
});
