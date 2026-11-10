"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.pushConfiguration = pushConfiguration;
exports.pushStatus = pushStatus;
exports.subscribePush = subscribePush;
exports.unsubscribePush = unsubscribePush;
const node_crypto_1 = require("node:crypto");
const webpush = __importStar(require("web-push"));
const prisma_1 = require("../../config/prisma");
const transaction_1 = require("../../utils/transaction");
const operations_schemas_1 = require("../operations/operations.schemas");
function pushConfiguration() {
    const publicKey = process.env.WEB_PUSH_PUBLIC_KEY || "", privateKey = process.env.WEB_PUSH_PRIVATE_KEY || "", subject = process.env.WEB_PUSH_SUBJECT || "";
    try {
        webpush.setVapidDetails(subject, publicKey, privateKey);
        const pair = (0, node_crypto_1.createECDH)("prime256v1");
        pair.setPrivateKey(Buffer.from(privateKey, "base64url"));
        if (pair.getPublicKey().toString("base64url") !== publicKey)
            return null;
        return { publicKey, privateKey, subject };
    }
    catch {
        return null;
    }
}
async function pushStatus(actor) {
    const subscriptions = await prisma_1.prisma.pushSubscription.findMany({ where: { userId: actor.userId, sessionId: actor.sessionId || "" }, select: { id: true, createdAt: true } });
    return { enabled: Boolean(pushConfiguration()), publicKey: pushConfiguration()?.publicKey || null, subscriptions };
}
async function subscribePush(input, actor) {
    if (!pushConfiguration())
        throw new operations_schemas_1.OperationError(503, "Las notificaciones externas no estan configuradas");
    if (!actor.sessionId)
        throw new operations_schemas_1.OperationError(401, "Inicie sesion nuevamente");
    if (input.expirationTime && input.expirationTime <= Date.now())
        throw new operations_schemas_1.OperationError(400, "Suscripcion vencida");
    const endpointHash = (0, node_crypto_1.createHash)("sha256").update(input.endpoint).digest("hex");
    return (0, transaction_1.serializable)(async (tx) => {
        const session = await tx.authSession.findFirst({ where: { id: actor.sessionId, userId: actor.userId, revokedAt: null, expiresAt: { gt: new Date() } } });
        if (!session)
            throw new operations_schemas_1.OperationError(401, "Sesion vencida");
        let existing = await tx.pushSubscription.findUnique({ where: { endpointHash }, include: { session: true } });
        if (existing && (existing.session.revokedAt || existing.session.expiresAt <= new Date())) {
            await tx.pushSubscription.delete({ where: { id: existing.id } });
            existing = null;
        }
        if (existing && existing.userId !== actor.userId)
            throw new operations_schemas_1.OperationError(409, "Desactive las notificaciones de la cuenta anterior en este navegador");
        await tx.pushSubscription.deleteMany({ where: { userId: actor.userId, session: { OR: [{ revokedAt: { not: null } }, { expiresAt: { lte: new Date() } }] } } });
        const count = await tx.pushSubscription.count({ where: { userId: actor.userId } });
        if (!existing && count >= 10)
            throw new operations_schemas_1.OperationError(409, "Limite de diez dispositivos alcanzado. Cierre sesiones anteriores");
        const row = await tx.pushSubscription.upsert({ where: { endpointHash }, create: { userId: actor.userId, sessionId: actor.sessionId, endpointHash, endpoint: input.endpoint, p256dh: input.keys.p256dh, auth: input.keys.auth }, update: { sessionId: actor.sessionId, p256dh: input.keys.p256dh, auth: input.keys.auth } });
        await tx.auditLog.create({ data: { actorUserId: actor.userId, action: "PUSH_SUBSCRIBED", entityType: "PushSubscription", entityId: row.id } });
        return { id: row.id, message: "Notificaciones activadas en este dispositivo" };
    });
}
async function unsubscribePush(id, actor) {
    return (0, transaction_1.serializable)(async (tx) => {
        const row = await tx.pushSubscription.findFirst({ where: { id, userId: actor.userId, sessionId: actor.sessionId || "" } });
        if (row) {
            await tx.pushSubscription.delete({ where: { id } });
            await tx.auditLog.create({ data: { actorUserId: actor.userId, action: "PUSH_UNSUBSCRIBED", entityType: "PushSubscription", entityId: id } });
        }
        return { message: "Suscripcion desactivada" };
    });
}
