"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.messageFingerprint = messageFingerprint;
const node_crypto_1 = require("node:crypto");
function messageFingerprint(message) {
    return (0, node_crypto_1.createHash)("sha256").update(JSON.stringify([message.id, message.body, (message.editedAt || message.createdAt).toISOString()])).digest("hex");
}
