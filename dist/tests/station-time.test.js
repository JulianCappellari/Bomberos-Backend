"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const station_time_1 = require("../utils/station-time");
const readiness_service_1 = require("../modules/dashboard/readiness.service");
(0, node_test_1.default)("El dia operativo usa Argentina aunque el servidor tenga otra zona horaria", () => {
    strict_1.default.equal((0, station_time_1.stationDate)(new Date("2026-11-05T02:59:59Z")), "2026-11-04");
    strict_1.default.equal((0, station_time_1.stationDate)(new Date("2026-11-05T03:00:00Z")), "2026-11-05");
});
(0, node_test_1.default)("El estado de guardia respeta el relevo argentino a las 08 y 20", () => {
    const date = new Date("2026-11-04T00:00:00Z");
    strict_1.default.equal((0, readiness_service_1.shiftPhase)(date, "DAY", new Date("2026-11-04T10:59:59Z"), "08:00", "20:00"), "UPCOMING");
    strict_1.default.equal((0, readiness_service_1.shiftPhase)(date, "DAY", new Date("2026-11-04T11:00:00Z"), "08:00", "20:00"), "ACTIVE");
    strict_1.default.equal((0, readiness_service_1.shiftPhase)(date, "DAY", new Date("2026-11-04T23:00:00Z"), "08:00", "20:00"), "FINISHED");
    strict_1.default.equal((0, readiness_service_1.shiftPhase)(date, "NIGHT", new Date("2026-11-05T10:59:59Z"), "20:00", "08:00"), "ACTIVE");
    strict_1.default.equal((0, readiness_service_1.shiftPhase)(date, "NIGHT", new Date("2026-11-05T11:00:00Z"), "20:00", "08:00"), "FINISHED");
});
