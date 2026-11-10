"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const rate_limit_middleware_1 = require("../middlewares/rate-limit.middleware");
const auth_schemas_1 = require("../modules/auth/auth.schemas");
(0, node_test_1.default)("Las claves nuevas respetan el limite de bytes de bcrypt", () => {
    const password = "a".repeat(12);
    (0, strict_1.default)(auth_schemas_1.changePasswordSchema.safeParse({ currentPassword: "old", newPassword: password, confirmPassword: password }).success);
    (0, strict_1.default)(!auth_schemas_1.changePasswordSchema.safeParse({ currentPassword: "old", newPassword: "short", confirmPassword: "short" }).success);
    const unicode = "\u00e1".repeat(40);
    (0, strict_1.default)(!auth_schemas_1.changePasswordSchema.safeParse({ currentPassword: "old", newPassword: unicode, confirmPassword: unicode }).success);
    (0, strict_1.default)(!auth_schemas_1.loginSchema.safeParse({ username: "user", password: "a".repeat(1025) }).success);
});
(0, node_test_1.default)("Cambiar X-Forwarded-For no permite evadir el limite de intentos", () => {
    const limit = (0, rate_limit_middleware_1.rateLimit)({ windowMs: 60000, maxRequests: 2 });
    for (const [index, expected] of [200, 200, 429].entries()) {
        let status = 200, nextCalls = 0;
        const headers = new Map();
        const req = { ip: "127.0.0.1", socket: { remoteAddress: "127.0.0.1" }, headers: { "x-forwarded-for": `192.0.2.${index}` } };
        const res = { setHeader: (key, value) => headers.set(key, value), status: (value) => { status = value; return res; }, json: () => res };
        limit(req, res, () => { nextCalls++; });
        strict_1.default.equal(status, expected);
        strict_1.default.equal(nextCalls, expected === 429 ? 0 : 1);
        if (expected === 429)
            (0, strict_1.default)(Number(headers.get("Retry-After")) > 0);
    }
});
