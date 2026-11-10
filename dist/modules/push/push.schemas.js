"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.subscriptionSchema = void 0;
exports.trustedPushEndpoint = trustedPushEndpoint;
exports.pushPolicy = pushPolicy;
exports.retryDelay = retryDelay;
const zod_1 = require("zod");
const node_crypto_1 = require("node:crypto");
// Endpoints are capability URLs. Never allow an arbitrary URL to become a server-side request.
const hosts = new Set(["fcm.googleapis.com", "updates.push.services.mozilla.com", "web.push.apple.com"]);
function trustedPushEndpoint(value) {
    try {
        const url = new URL(value);
        return url.protocol === "https:" && !url.username && !url.password && !url.hash && !url.port && hosts.has(url.hostname) && url.pathname.length > 1;
    }
    catch {
        return false;
    }
}
function key(value, length) {
    return /^[A-Za-z0-9_-]+$/.test(value) && Buffer.from(value, "base64url").length === length;
}
function publicKey(value) {
    if (!key(value, 65) || Buffer.from(value, "base64url")[0] !== 4)
        return false;
    try {
        node_crypto_1.ECDH.convertKey(Buffer.from(value, "base64url"), "prime256v1");
        return true;
    }
    catch {
        return false;
    }
}
exports.subscriptionSchema = zod_1.z.object({
    endpoint: zod_1.z.string().max(2048).refine(trustedPushEndpoint, "Proveedor de notificaciones no admitido"),
    expirationTime: zod_1.z.number().positive().nullable().optional(),
    keys: zod_1.z.object({
        p256dh: zod_1.z.string().max(100).refine(publicKey, "Clave de dispositivo invalida"),
        auth: zod_1.z.string().max(50).refine(v => key(v, 16), "Autenticacion de dispositivo invalida"),
    }).strict(),
}).strict();
function pushPolicy(href) {
    const alert = /^\/alerts(?:\/|\?|$)/.test(href);
    return { maxAgeMs: (alert ? 15 * 60 : 24 * 60 * 60) * 1000, urgency: alert ? "high" : "normal", alert };
}
function retryDelay(attempts) { return Math.min(15 * 60000, 30000 * 2 ** Math.max(0, attempts - 1)); }
