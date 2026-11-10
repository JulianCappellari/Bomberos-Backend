import { createECDH, createHash } from "node:crypto";
import * as webpush from "web-push";
import { prisma } from "../../config/prisma";
import { serializable } from "../../utils/transaction";
import { OperationError } from "../operations/operations.schemas";
import { subscriptionSchema } from "./push.schemas";
import { z } from "zod";

export function pushConfiguration() {
  const publicKey = process.env.WEB_PUSH_PUBLIC_KEY || "", privateKey = process.env.WEB_PUSH_PRIVATE_KEY || "", subject = process.env.WEB_PUSH_SUBJECT || "";
  try {
    webpush.setVapidDetails(subject, publicKey, privateKey);
    const pair = createECDH("prime256v1"); pair.setPrivateKey(Buffer.from(privateKey, "base64url"));
    if (pair.getPublicKey().toString("base64url") !== publicKey) return null;
    return { publicKey, privateKey, subject };
  } catch { return null; }
}
type Actor = { userId: string; sessionId?: string };
export async function pushStatus(actor: Actor) {
  const subscriptions = await prisma.pushSubscription.findMany({ where: { userId: actor.userId, sessionId: actor.sessionId || "" }, select: { id: true, createdAt: true } });
  return { enabled: Boolean(pushConfiguration()), publicKey: pushConfiguration()?.publicKey || null, subscriptions };
}
export async function subscribePush(input: z.infer<typeof subscriptionSchema>, actor: Actor) {
  if (!pushConfiguration()) throw new OperationError(503, "Las notificaciones externas no estan configuradas");
  if (!actor.sessionId) throw new OperationError(401, "Inicie sesion nuevamente");
  if (input.expirationTime && input.expirationTime <= Date.now()) throw new OperationError(400, "Suscripcion vencida");
  const endpointHash = createHash("sha256").update(input.endpoint).digest("hex");
  return serializable(async tx => {
    const session = await tx.authSession.findFirst({ where: { id: actor.sessionId, userId: actor.userId, revokedAt: null, expiresAt: { gt: new Date() } } });
    if (!session) throw new OperationError(401, "Sesion vencida");
    let existing = await tx.pushSubscription.findUnique({ where: { endpointHash }, include: { session: true } });
    if (existing && (existing.session.revokedAt || existing.session.expiresAt <= new Date())) {
      await tx.pushSubscription.delete({ where: { id: existing.id } }); existing = null;
    }
    if (existing && existing.userId !== actor.userId) throw new OperationError(409, "Desactive las notificaciones de la cuenta anterior en este navegador");
    await tx.pushSubscription.deleteMany({ where: { userId: actor.userId, session: { OR: [{ revokedAt: { not: null } }, { expiresAt: { lte: new Date() } }] } } });
    const count = await tx.pushSubscription.count({ where: { userId: actor.userId } });
    if (!existing && count >= 10) throw new OperationError(409, "Limite de diez dispositivos alcanzado. Cierre sesiones anteriores");
    const row = await tx.pushSubscription.upsert({ where: { endpointHash }, create: { userId: actor.userId, sessionId: actor.sessionId!, endpointHash, endpoint: input.endpoint, p256dh: input.keys.p256dh, auth: input.keys.auth }, update: { sessionId: actor.sessionId!, p256dh: input.keys.p256dh, auth: input.keys.auth } });
    await tx.auditLog.create({ data: { actorUserId: actor.userId, action: "PUSH_SUBSCRIBED", entityType: "PushSubscription", entityId: row.id } });
    return { id: row.id, message: "Notificaciones activadas en este dispositivo" };
  });
}
export async function unsubscribePush(id: string, actor: Actor) {
  return serializable(async tx => {
    const row = await tx.pushSubscription.findFirst({ where: { id, userId: actor.userId, sessionId: actor.sessionId || "" } });
    if (row) {
      await tx.pushSubscription.delete({ where: { id } });
      await tx.auditLog.create({ data: { actorUserId: actor.userId, action: "PUSH_UNSUBSCRIBED", entityType: "PushSubscription", entityId: id } });
    }
    return { message: "Suscripcion desactivada" };
  });
}
