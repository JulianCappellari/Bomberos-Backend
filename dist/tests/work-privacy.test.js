"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const work_privacy_1 = require("../modules/work/work-privacy");
(0, node_test_1.default)("Task responses do not expose private ranking keys or recovery reasons", () => { const date = new Date(); const value = (0, work_privacy_1.publicWorkResponse)({ items: [{ rankingRecoveryKey: "secret", title: "Tarea normal", notes: "Asignación aleatoria de recuperación por puntaje bajo", createdAt: date }] }); (0, strict_1.default)(!JSON.stringify(value).includes("ranking")); (0, strict_1.default)(!JSON.stringify(value).includes("puntaje")); (0, strict_1.default)(JSON.stringify(value).includes(date.toISOString())); });
