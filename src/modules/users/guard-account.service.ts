import bcrypt from "bcrypt";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../config/prisma";
import { serializable } from "../../utils/transaction";
import { guardFunctionAllowed, normalizeRank } from "../../utils/firefighter-ranks";
import { OperationError } from "../operations/operations.schemas";
import { notify } from "../members/notifications.service";

// La guardia usa una cuenta propia (otro usuario y otra contraseña), separada de la cuenta personal
// de quien la cumple. Asi lo que hace como guardia nunca suma a su asistencia personal.
export const createGuardAccountSchema = z.object({
  username: z.string().trim().toLowerCase().min(3, "Usuario de al menos 3 caracteres").max(50).regex(/^[a-z0-9._-]+$/, "Usá solo letras, números, punto, guion o guion bajo"),
  password: z.string().min(12, "Use al menos 12 caracteres").max(72).refine((v) => Buffer.byteLength(v, "utf8") <= 72, "La clave no debe superar 72 bytes"),
  reason: z.string().trim().min(10).max(1000),
}).strict();

const ACTIVE_WINDOW_MS = 12 * 3600_000;

export async function getGuardAccount(ownerId: string) {
  const account = await prisma.user.findFirst({ where: { guardForUserId: ownerId, deletedAt: null }, select: { id: true, username: true, isActive: true, mustChangePassword: true, updatedAt: true, createdAt: true } });
  if (!account) return { account: null };
  const lastSession = await prisma.authSession.findFirst({ where: { userId: account.id }, orderBy: { lastUsedAt: "desc" }, select: { lastUsedAt: true, revokedAt: true, expiresAt: true } });
  const onDuty = Boolean(lastSession && !lastSession.revokedAt && lastSession.expiresAt > new Date() && lastSession.lastUsedAt > new Date(Date.now() - ACTIVE_WINDOW_MS));
  return { account: { ...account, lastUsedAt: lastSession?.lastUsedAt ?? null, onDuty } };
}

export async function createGuardAccount(ownerId: string, input: z.infer<typeof createGuardAccountSchema>, actorUserId: string) {
  const passwordHash = await bcrypt.hash(input.password, 10);
  return serializable(async (tx) => {
    const owner = await tx.user.findFirst({ where: { id: ownerId, deletedAt: null }, include: { profile: true } });
    if (!owner?.profile) throw new OperationError(404, "Persona no encontrada");
    if (owner.guardForUserId) throw new OperationError(400, "Una cuenta de guardia no puede tener otra cuenta de guardia");
    if (!owner.isActive || owner.isPendingApproval || !guardFunctionAllowed(true, owner.profile.rank)) throw new OperationError(400, "Solo personal operativo activo (Bombero, Oficial o Sub oficial) puede tener cuenta de guardia");
    if (await tx.user.findFirst({ where: { guardForUserId: ownerId, deletedAt: null }, select: { id: true } })) throw new OperationError(409, "Esta persona ya tiene una cuenta de guardia");
    if (await tx.user.findUnique({ where: { username: input.username }, select: { id: true } })) throw new OperationError(409, "Ese nombre de usuario ya existe");
    const dni = `G-${owner.profile.dni}`.slice(0, 20), badge = `G-${owner.profile.badge}`.slice(0, 30);
    if (await tx.firefighterProfile.findFirst({ where: { OR: [{ dni }, { badge }] }, select: { id: true } })) throw new OperationError(409, "Ya existe un perfil de guardia con los datos de esta persona");
    const account = await tx.user.create({
      data: {
        username: input.username, passwordHash, role: "FIREFIGHTER", isActive: true, isPendingApproval: false, mustChangePassword: true, guardForUserId: ownerId,
        profile: { create: { fullName: `Guardia · ${owner.profile.fullName}`.slice(0, 120), rank: "Guardia", dni, badge, phone: owner.profile.phone } },
      },
      select: { id: true, username: true, isActive: true, mustChangePassword: true, updatedAt: true, createdAt: true },
    });
    await tx.auditLog.create({ data: { actorUserId, action: "GUARD_ACCOUNT_CREATED", entityType: "User", entityId: account.id, metadata: { ownerUserId: ownerId, username: account.username, reason: input.reason } } });
    await notify(tx, [ownerId], "Se creó tu cuenta de guardia", "/me", `Usuario: ${account.username}. Ingresá con esa cuenta solo cuando cumplas la guardia; tu asistencia personal se marca con tu cuenta de siempre.`);
    return { account: { ...account, lastUsedAt: null, onDuty: false } };
  });
}

/** Al entrar con la cuenta de guardia termina la permanencia personal abierta de su titular (no se cuentan horas dobles). */
export async function closeOwnerAttendanceForGuard(tx: Prisma.TransactionClient, guard: { id: string; guardForUserId: string | null; profile?: { rank: string } | null }) {
  if (!guard.guardForUserId || normalizeRank(guard.profile?.rank) !== "guardia") return null;
  const open = await tx.attendance.findFirst({ where: { userId: guard.guardForUserId, status: "OPEN" }, orderBy: { createdAt: "desc" } });
  if (!open) return null;
  const now = new Date(), workedMinutes = open.checkInAt ? Math.max(0, Math.floor((now.getTime() - open.checkInAt.getTime()) / 60000)) : 0;
  await tx.attendance.update({ where: { id: open.id }, data: { status: "CLOSED", checkOutAt: now, workedMinutes, checkOutTrust: "MEDIUM" } });
  await tx.attendanceRecord.create({ data: { userId: guard.guardForUserId, type: "EXIT", method: "QR", notes: "Salida automática al ingresar con la cuenta de guardia" } });
  await tx.auditLog.create({ data: { actorUserId: guard.id, action: "ATTENDANCE_CLOSED_FOR_GUARD", entityType: "Attendance", entityId: open.id, metadata: { ownerUserId: guard.guardForUserId, workedMinutes } } });
  return open.id;
}

/** Cuentas de guardia de esta persona con una sesion en uso (ultimas 12 h). */
export async function ownerOnGuardDuty(tx: Prisma.TransactionClient, ownerId: string) {
  const since = new Date(Date.now() - ACTIVE_WINDOW_MS), now = new Date();
  return Boolean(await tx.authSession.findFirst({
    where: { revokedAt: null, expiresAt: { gt: now }, lastUsedAt: { gt: since }, OR: [{ user: { guardForUserId: ownerId, isActive: true, deletedAt: null } }, { userId: ownerId, guardMode: true }] },
    select: { id: true },
  }));
}
