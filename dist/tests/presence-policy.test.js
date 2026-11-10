"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const presence_policy_1 = require("../modules/members/presence-policy");
const hour = 3600000;
(0, node_test_1.default)("La excepcion de guardia dura hasta el fin del turno asignado y cada turno es independiente", () => {
    const checkIn = new Date("2026-11-06T08:00:00-03:00"), t = checkIn.getTime();
    strict_1.default.equal((0, presence_policy_1.guardPresenceUntil)(checkIn, [{ start: t, end: t + 4 * hour }]).getTime(), t + 4 * hour);
    strict_1.default.equal((0, presence_policy_1.guardPresenceUntil)(checkIn, [{ start: t, end: t + 12 * hour }, { start: t + 12 * hour, end: t + 24 * hour }]).getTime(), t + 12 * hour);
    strict_1.default.equal((0, presence_policy_1.guardPresenceUntil)(new Date(t + 12 * hour), [{ start: t, end: t + 12 * hour }, { start: t + 12 * hour, end: t + 24 * hour }]).getTime(), t + 24 * hour);
});
(0, node_test_1.default)("Guardias futuras o terminadas no eximen de revalidar", () => {
    const checkIn = new Date("2026-11-06T11:00:00Z"), t = checkIn.getTime();
    strict_1.default.equal((0, presence_policy_1.guardPresenceUntil)(checkIn, [{ start: t + hour, end: t + 12 * hour }]), null);
    strict_1.default.equal((0, presence_policy_1.guardPresenceUntil)(checkIn, [{ start: t - hour, end: t }]), null);
});
