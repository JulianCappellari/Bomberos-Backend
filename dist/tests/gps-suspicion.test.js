"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const gps_suspicion_1 = require("../utils/gps-suspicion");
(0, node_test_1.default)("T09: senales de GPS fabricado", () => {
    strict_1.default.deepEqual((0, gps_suspicion_1.gpsSuspicionReasons)({ latitude: -33.123456, longitude: -64.654321, accuracy: 8 }), []);
    strict_1.default.equal((0, gps_suspicion_1.gpsSuspicionReasons)({ latitude: -33.1234, longitude: -64.6543, accuracy: 0 }).length, 1);
    strict_1.default.equal((0, gps_suspicion_1.gpsSuspicionReasons)({ latitude: -33, longitude: -64, accuracy: 5 }).length, 1);
    strict_1.default.equal((0, gps_suspicion_1.gpsSuspicionReasons)({ latitude: -33.123456, longitude: -64.654321, accuracy: 8 }, { latitude: -33.123456, longitude: -64.654321 }).length, 1);
});
