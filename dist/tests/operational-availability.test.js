"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const operational_availability_1 = require("../modules/members/operational-availability");
(0, node_test_1.default)("El despliegue prevalece sobre presencia y una ausencia programada no oculta la presencia QR", () => {
    strict_1.default.equal((0, operational_availability_1.operationalStatus)(true, true, true, true), "DEPLOYED");
    strict_1.default.equal((0, operational_availability_1.operationalStatus)(false, true, true, false), "PRESENT");
    strict_1.default.equal((0, operational_availability_1.operationalStatus)(false, false, true, true), "UNAVAILABLE");
});
(0, node_test_1.default)("No se presenta como disponible a quien nunca confirmó", () => {
    strict_1.default.equal((0, operational_availability_1.operationalStatus)(false, false, false, false), "UNKNOWN");
    strict_1.default.equal((0, operational_availability_1.operationalStatus)(false, false, false, true), "AVAILABLE");
});
