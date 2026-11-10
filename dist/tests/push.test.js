"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const node_crypto_1 = require("node:crypto");
const push_schemas_1 = require("../modules/push/push.schemas");
(0, node_test_1.default)("push endpoints only allow HTTPS on trusted providers, never an arbitrary host", () => {
    for (const host of ["fcm.googleapis.com", "updates.push.services.mozilla.com", "web.push.apple.com"])
        (0, strict_1.default)((0, push_schemas_1.trustedPushEndpoint)(`https://${host}/push/capability`));
    for (const value of ["http://fcm.googleapis.com/push", "https://localhost/push", "https://127.0.0.1/push", "https://fcm.googleapis.com.evil.example/push", "https://fcm.googleapis.com:4000/push", "https://user@fcm.googleapis.com/push", "https://fcm.googleapis.com/push#fragment", "file:///etc/hosts"])
        (0, strict_1.default)(!(0, push_schemas_1.trustedPushEndpoint)(value), value);
});
(0, node_test_1.default)("push subscription validates uncompressed P256 and 16-byte auth, rejects extra fields", () => {
    const pair = (0, node_crypto_1.createECDH)("prime256v1");
    pair.generateKeys();
    const input = { endpoint: "https://web.push.apple.com/test", keys: { p256dh: pair.getPublicKey().toString("base64url"), auth: (0, node_crypto_1.randomBytes)(16).toString("base64url") } };
    (0, strict_1.default)(push_schemas_1.subscriptionSchema.safeParse(input).success);
    (0, strict_1.default)(!push_schemas_1.subscriptionSchema.safeParse({ ...input, keys: { ...input.keys, auth: "short" } }).success);
    (0, strict_1.default)(!push_schemas_1.subscriptionSchema.safeParse({ ...input, userId: "someone-else" }).success);
});
(0, node_test_1.default)("emergency messages expire quickly and retries are bounded", () => {
    strict_1.default.equal((0, push_schemas_1.pushPolicy)("/alerts").maxAgeMs, 900000);
    strict_1.default.equal((0, push_schemas_1.pushPolicy)("/notifications").maxAgeMs, 86400000);
    (0, strict_1.default)(!(0, push_schemas_1.pushPolicy)("/alerts-untrusted").alert);
    strict_1.default.equal((0, push_schemas_1.retryDelay)(1), 30000);
    strict_1.default.equal((0, push_schemas_1.retryDelay)(5), 480000);
    strict_1.default.equal((0, push_schemas_1.retryDelay)(100), 900000);
});
