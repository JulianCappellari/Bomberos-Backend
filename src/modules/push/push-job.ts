import * as webpush from "web-push";
import { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma";
import { pushConfiguration } from "./push.service";
import { pushPolicy, retryDelay, trustedPushEndpoint } from "./push.schemas";

type Sender = (subscription: webpush.PushSubscription, payload: string, options: webpush.RequestOptions) => Promise<unknown>;
// A committed notification is the source of truth; no network requests happen inside business transactions.
export async function queuePush(now = new Date()) {
  return prisma.$transaction(async tx => {
    const alerts = await tx.memberNotification.findMany({ where: { pushQueuedAt: null, href: "/alerts", readAt: null, createdAt: { gte: new Date(now.getTime() - 15 * 60000), lte: now } }, take: 50, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    const others = alerts.length < 50 ? await tx.memberNotification.findMany({ where: { pushQueuedAt: null, id: { notIn: alerts.map(row => row.id) }, createdAt: { gte: new Date(now.getTime() - 24 * 3600000), lte: now } }, take: 50 - alerts.length, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }) : [];
    const notifications = [...alerts, ...others];
    for (const notification of notifications) {
      if (!notification.readAt && now.getTime() - notification.createdAt.getTime() < pushPolicy(notification.href).maxAgeMs) {
        const subscriptions = await tx.pushSubscription.findMany({ where: { userId: notification.userId, createdAt: { lte: notification.createdAt }, session: { revokedAt: null, expiresAt: { gt: now } }, user: { isActive: true, isPendingApproval: false, deletedAt: null, mustChangePassword: false } }, select: { id: true } });
        await tx.pushDelivery.createMany({ data: subscriptions.map(s => ({ subscriptionId: s.id, notificationId: notification.id })), skipDuplicates: true });
      }
      await tx.memberNotification.update({ where: { id: notification.id }, data: { pushQueuedAt: now } });
    }
    return notifications.length;
  });
}

export async function deliverPush(sender: Sender = webpush.sendNotification, now = new Date()) {
  const config = pushConfiguration(); if (!config) return 0;
  const ready = { finishedAt: null, nextAttemptAt: { lte: now }, OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }] } satisfies Prisma.PushDeliveryWhereInput;
  const alerts = await prisma.pushDelivery.findMany({ where: { ...ready, notification: { href: "/alerts" } }, orderBy: { nextAttemptAt: "asc" }, take: 30, select: { id: true } });
  const others = alerts.length < 30 ? await prisma.pushDelivery.findMany({ where: { ...ready, notification: { href: { not: "/alerts" } } }, orderBy: { nextAttemptAt: "asc" }, take: 30 - alerts.length, select: { id: true } }) : [];
  const rows = [...alerts, ...others];
  let sent = 0;
  const process = async (candidate: { id: string }) => {
    const claimed = await prisma.pushDelivery.updateMany({ where: { id: candidate.id, ...ready }, data: { leaseUntil: new Date(Date.now() + 5 * 60000), attempts: { increment: 1 } } });
    if (!claimed.count) return;
    const row = await prisma.pushDelivery.findUnique({ where: { id: candidate.id }, include: { notification: true, subscription: { include: { session: true, user: true } } } });
    if (!row) return;
    const { notification, subscription } = row, policy = pushPolicy(notification.href);
    const checkedAt = new Date();
    let priority: string | null = null;
    const elapsed = Date.now() - notification.createdAt.getTime();
    let code: string | null = null;
    if (notification.readAt || notification.userId !== subscription.userId || subscription.session.userId !== subscription.userId || subscription.session.revokedAt || subscription.session.expiresAt <= checkedAt || !subscription.user.isActive || subscription.user.isPendingApproval || subscription.user.deletedAt || subscription.user.mustChangePassword) code = "INACTIVE_OR_READ";
    else if (elapsed >= policy.maxAgeMs) code = "EXPIRED";
    else if (!trustedPushEndpoint(subscription.endpoint)) code = "INVALID_ENDPOINT";
    else if (policy.alert) {
      const match = notification.dedupeKey?.match(/^alert:([^:]+):/);
      const alert = match ? await prisma.alert.findFirst({ where: { id: match[1]!, status: "ACTIVE" }, select: { priority: true } }) : null;
      if (!alert) code = "ALERT_NOT_ACTIVE"; else priority = alert.priority;
    }
    if (code) { await prisma.pushDelivery.updateMany({ where: { id: row.id }, data: { finishedAt: now, leaseUntil: null, errorCode: code } }); return; }
    try {
      // Lock-screen content is deliberately generic, including for medical incidents and personal reminders.
      await sender({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } }, JSON.stringify({ version: 1, id: notification.id, alert: policy.alert, priority, expiresAt: notification.createdAt.getTime() + policy.maxAgeMs }), { vapidDetails: config, TTL: Math.max(1, Math.floor((policy.maxAgeMs - elapsed) / 1000)), urgency: priority === "HIGH" ? "high" : "normal", timeout: 8000 });
      await prisma.pushDelivery.updateMany({ where: { id: row.id }, data: { deliveredAt: new Date(), finishedAt: new Date(), leaseUntil: null, errorCode: null } });
      sent++;
    } catch (error) {
      const status = typeof error === "object" && error && "statusCode" in error ? Number(error.statusCode) : 0;
      if (status === 404 || status === 410) {
        await prisma.pushSubscription.deleteMany({ where: { id: subscription.id } });
      } else {
        // S04: se reintenta una sola vez una notificacion no entregada.
        const permanent = row.attempts >= 2 || (status >= 400 && status < 500 && status !== 429);
        await prisma.pushDelivery.updateMany({ where: { id: row.id }, data: { leaseUntil: null, finishedAt: permanent ? new Date() : null, nextAttemptAt: new Date(Date.now() + retryDelay(row.attempts)), errorCode: status ? `HTTP_${status}` : "NETWORK" } });
      }
    }
  };
  let cursor = 0;
  const results = await Promise.allSettled(Array.from({ length: Math.min(4, rows.length) }, async () => {
    while (cursor < rows.length) await process(rows[cursor++]!);
  }));
  const failed = results.find(result => result.status === "rejected");
  if (failed?.status === "rejected") throw failed.reason;
  return sent;
}

export function startPushJob() {
  if (!pushConfiguration()) { console.warn("Web Push desactivado: configure las claves VAPID y WEB_PUSH_SUBJECT"); return () => {}; }
  let running = false;
  const tick = async () => {
    if (running) return; running = true;
    try { await queuePush(); await deliverPush(); }
    catch { console.error("No se pudo procesar la cola de Web Push"); }
    finally { running = false; }
  };
  void tick(); const timer = setInterval(() => { void tick(); }, 10000); timer.unref();
  return () => clearInterval(timer);
}
