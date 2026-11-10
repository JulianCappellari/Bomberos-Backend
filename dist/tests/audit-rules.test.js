"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const audit_rules_1 = require("../utils/audit-rules");
(0, node_test_1.test)("La auditoria admite accesos anonimos denegados sin inventar un actor", () => {
    for (const status of [401, 403])
        strict_1.default.equal((0, audit_rules_1.auditActorRequired)("HTTP_ACCESS_DENIED", "HttpRequest", { status }), false);
    for (const metadata of [null, {}, { status: 200 }, { status: "otro" }])
        strict_1.default.equal((0, audit_rules_1.auditActorRequired)("HTTP_ACCESS_DENIED", "HttpRequest", metadata), true);
});
(0, node_test_1.test)("Las mutaciones operativas siguen exigiendo actor", () => {
    strict_1.default.equal((0, audit_rules_1.auditActorRequired)("HTTP_MUTATION", "HttpRequest", { status: 403 }), true);
    strict_1.default.equal((0, audit_rules_1.auditActorRequired)("DOCUMENT_CREATED", "OperationalDocument", {}), true);
    strict_1.default.equal((0, audit_rules_1.auditActorRequired)("HTTP_ACCESS_DENIED", "User", { status: 401 }), true);
});
(0, node_test_1.test)("Los procesos de sistema conservan su excepcion explicita", () => {
    strict_1.default.equal((0, audit_rules_1.auditActorRequired)("SYSTEM_PRESENCE_EXPIRED", "Attendance", {}), false);
    strict_1.default.equal((0, audit_rules_1.auditActorRequired)("SEED_LOADED", "System", {}), false);
});
