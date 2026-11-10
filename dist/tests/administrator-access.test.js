"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const role_middleware_1 = require("../middlewares/role.middleware");
const reports_service_1 = require("../modules/operations/reports.service");
(0, node_test_1.test)("Solo ADMIN puede pasar el control administrativo de auditoria", () => {
    for (const role of ["ADMIN", "OPERATOR", "FIREFIGHTER"]) {
        let passed = false, status = 0;
        const res = { status(code) { status = code; return this; }, json() { } };
        (0, role_middleware_1.authorize)("ADMIN")({ user: { userId: "test", role } }, res, () => { passed = true; });
        strict_1.default.equal(passed, role === "ADMIN");
        if (role !== "ADMIN")
            strict_1.default.equal(status, 403);
    }
});
(0, node_test_1.test)("El reporte anual global sigue reservado a ADMIN; la consulta individual de jefatura tiene su permiso separado", () => {
    strict_1.default.equal((0, reports_service_1.canReadAllPersonnelStats)("ADMIN"), true);
    for (const role of ["OPERATOR", "FIREFIGHTER", "", "oficial"])
        strict_1.default.equal((0, reports_service_1.canReadAllPersonnelStats)(role), false);
});
