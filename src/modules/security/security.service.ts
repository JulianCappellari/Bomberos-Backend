import { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma";
import { serializable } from "../../utils/transaction";
import { disconnectUser } from "../../config/socket";
import { OperationError } from "../operations/operations.schemas";
import { LOCK_MINUTES, MAX_FAILED_LOGINS } from "../auth/auth.service";

type Actor = { userId: string; role: string };
// Acciones que interesan a la seguridad del sistema y a la deteccion de fraude.
export const SECURITY_ACTIONS = [
  "AUTH_LOGIN_FAILED", "AUTH_ACCOUNT_LOCKED", "AUTH_LOGIN_WHILE_LOCKED", "AUTH_NEW_DEVICE", "AUTH_REFRESH_REPLAY_BLOCKED",
  "PRESENCE_GPS_SUSPICIOUS", "ATTENDANCE_SHARED_DEVICE", "ALERT_BURST_DETECTED",
  "SECURITY_ANOMALY_MASS_CHANGE", "SECURITY_ANOMALY_BRUTE_FORCE", "SECURITY_ACCOUNT_UNLOCKED", "SECURITY_SESSIONS_REVOKED",
] as const;
const DESTRUCTIVE = /(DELETE|DELETED|VOID|VOIDED|REMOVE|REMOVED|ARCHIV|RETIRED|CANCEL|REVOKE)/;

async function securityRecipients(tx: Prisma.TransactionClient) {
  const rows = await tx.user.findMany({ where: { isActive: true, deletedAt: null, OR: [{ role: "ADMIN" }, { profile: { rank: { in: ["Administrador", "Oficial"] } } }] }, select: { id: true } });
  return rows.map((r) => r.id);
}
const nameOf = (u?: { username: string; profile: { fullName: string } | null } | null) => u ? u.profile?.fullName || u.username : "Sistema";

export async function securityOverview(actor: Actor) {
  if (actor.role !== "ADMIN") throw new OperationError(403, "Centro de seguridad reservado a administración");
  const since = new Date(Date.now() - 7 * 86_400_000), now = new Date();
  const [locked, events, grouped, trigger, sessions] = await Promise.all([
    prisma.user.findMany({ where: { lockedUntil: { gt: now } }, select: { id: true, username: true, lockedUntil: true, profile: { select: { fullName: true } } } }),
    prisma.auditLog.findMany({ where: { action: { in: [...SECURITY_ACTIONS] }, createdAt: { gt: since } }, orderBy: { createdAt: "desc" }, take: 150, include: { actor: { select: { username: true, profile: { select: { fullName: true } } } } } }),
    prisma.auditLog.groupBy({ by: ["action"], where: { action: { in: [...SECURITY_ACTIONS] }, createdAt: { gt: since } }, _count: { _all: true } }),
    prisma.$queryRaw<Array<{ tgname: string }>>`SELECT t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = current_schema() AND c.relname = 'AuditLog' AND t.tgname IN ('audit_log_append_only', 'audit_log_no_truncate') AND NOT t.tgisinternal AND t.tgenabled <> 'D'`,
    prisma.authSession.groupBy({ by: ["userId"], where: { revokedAt: null, expiresAt: { gt: now } }, _count: { _all: true } }),
  ]);
  // Nombre de la persona afectada cuando la entidad es un usuario (intentos fallidos, bloqueos).
  const targetIds = [...new Set(events.filter((e) => e.entityType === "User").map((e) => e.entityId))];
  const manySessions = sessions.filter((s) => s._count._all >= 4).map((s) => s.userId);
  const people = await prisma.user.findMany({ where: { id: { in: [...targetIds, ...manySessions] } }, select: { id: true, username: true, profile: { select: { fullName: true } } } });
  const personName = (id: string) => nameOf(people.find((p) => p.id === id));
  return {
    generatedAt: now,
    protection: {
      auditAppendOnly: trigger.length === 2,
      loginLock: { attempts: MAX_FAILED_LOGINS, minutes: LOCK_MINUTES },
      measures: [
        "Contraseñas con hash bcrypt y sesiones con rotación de credenciales y detección de reutilización.",
        `Bloqueo de cuenta tras ${MAX_FAILED_LOGINS} intentos fallidos (${LOCK_MINUTES} min) y límite de intentos por dirección de red.`,
        "Aviso al titular cuando se ingresa desde un dispositivo nuevo.",
        "QR rotativo, validación de ubicación a 100 m y marca de GPS sospechoso.",
        "Detección de un mismo celular fichando a distintas personas.",
        "Doble autorización en correcciones de fichaje y aperturas manuales.",
        "Aviso a jefatura ante alertas en ráfaga y cambios masivos.",
        "Auditoría inalterable: ningún registro se puede modificar ni borrar.",
      ],
    },
    lockedAccounts: locked.map((u) => ({ userId: u.id, name: nameOf(u), lockedUntil: u.lockedUntil })),
    counts: Object.fromEntries(grouped.map((g) => [g.action, g._count._all])),
    sessionsWarning: sessions.filter((s) => s._count._all >= 4).map((s) => ({ userId: s.userId, name: personName(s.userId), active: s._count._all })),
    events: events.map((e) => ({ id: e.id, action: e.action, createdAt: e.createdAt, actor: e.actorUserId ? nameOf(e.actor) : "Sistema", target: e.entityType === "User" ? personName(e.entityId) : null, metadata: e.metadata })),
  };
}

export async function unlockAccount(actor: Actor, userId: string) {
  if (actor.role !== "ADMIN") throw new OperationError(403, "Solo administración desbloquea cuentas");
  return serializable(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true, lockedUntil: true } });
    if (!user) throw new OperationError(404, "Usuario no encontrado");
    await tx.user.update({ where: { id: userId }, data: { lockedUntil: null, failedLoginCount: 0 } });
    await tx.auditLog.create({ data: { actorUserId: actor.userId, action: "SECURITY_ACCOUNT_UNLOCKED", entityType: "User", entityId: userId, metadata: { wasLockedUntil: user.lockedUntil } } });
    return { unlocked: true };
  });
}

export async function revokeAllSessions(actor: Actor, userId: string, reason: string) {
  if (actor.role !== "ADMIN") throw new OperationError(403, "Solo administración cierra sesiones ajenas");
  if (userId === actor.userId) throw new OperationError(400, "Para cerrar tus propias sesiones usá Mi perfil → Seguridad");
  const result = await serializable(async (tx) => {
    const changed = await tx.authSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
    await tx.auditLog.create({ data: { actorUserId: actor.userId, action: "SECURITY_SESSIONS_REVOKED", entityType: "User", entityId: userId, metadata: { sessions: changed.count, reason } } });
    await tx.memberNotification.create({ data: { userId, title: "Administración cerró tus sesiones", href: "/login", body: reason } });
    return { revoked: changed.count };
  });
  disconnectUser(userId);
  return result;
}

/** Revision periodica: cambios destructivos masivos y ataques de contrasena. Avisa una vez por franja. */
export async function detectSecurityAnomalies(now = new Date()) {
  const since = new Date(now.getTime() - 10 * 60_000);
  const bucket = Math.floor(now.getTime() / (30 * 60_000));
  const recent = await prisma.auditLog.findMany({ where: { createdAt: { gt: since } }, select: { actorUserId: true, action: true } });
  const perActor = new Map<string, number>();
  for (const row of recent) if (row.actorUserId && DESTRUCTIVE.test(row.action) && !row.action.startsWith("SECURITY_") && row.action !== "AUTH_REFRESH_REPLAY_BLOCKED") perActor.set(row.actorUserId, (perActor.get(row.actorUserId) ?? 0) + 1);
  const failed = recent.filter((r) => r.action === "AUTH_LOGIN_FAILED").length;
  let raised = 0;
  await prisma.$transaction(async (tx) => {
    const recipients = await securityRecipients(tx);
    for (const [userId, count] of perActor) {
      if (count < 10) continue;
      const created = await tx.memberNotification.createMany({ data: recipients.filter((id) => id !== userId).map((id) => ({ userId: id, dedupeKey: `sec-mass:${userId}:${bucket}:${id}`, title: "Muchas eliminaciones o anulaciones seguidas", href: "/security-center", body: `Una misma cuenta hizo ${count} acciones de borrado, anulación o cancelación en 10 minutos. Revisá la auditoría.` })), skipDuplicates: true });
      if (created.count) { raised++; await tx.auditLog.create({ data: { actorUserId: null, action: "SECURITY_ANOMALY_MASS_CHANGE", entityType: "User", entityId: userId, metadata: { actionsInTenMinutes: count } } }); }
    }
    if (failed >= 20) {
      const created = await tx.memberNotification.createMany({ data: recipients.map((id) => ({ userId: id, dedupeKey: `sec-brute:${bucket}:${id}`, title: "Muchos intentos de ingreso fallidos", href: "/security-center", body: `Hubo ${failed} intentos fallidos de ingreso en 10 minutos. Puede ser un ataque de contraseñas.` })), skipDuplicates: true });
      if (created.count) { raised++; await tx.auditLog.create({ data: { actorUserId: null, action: "SECURITY_ANOMALY_BRUTE_FORCE", entityType: "System", entityId: "auth", metadata: { failedInTenMinutes: failed } } }); }
    }
  });
  return raised;
}
