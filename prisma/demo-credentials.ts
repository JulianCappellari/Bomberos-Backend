import bcrypt from "bcrypt";
import { Prisma } from "@prisma/client";

export const DEMO_PASSWORD = "BomberosSampacho2026!";
export const DEMO_LOGIN_KEYS = ["admin", "subjefe", "operador", "oficial", "bombero", "sofia", "nicolas", "camila", "aspirante", "directiva", "lucia", "guardia_bombero", "guardia_sofia"] as const;

export async function resetDemoCredentials(tx: Prisma.TransactionClient, password: string) {
  const [database] = await tx.$queryRaw<Array<{ schema: string }>>`SELECT current_schema() AS schema`;
  if (!database || !/^bomberos_demo(?:_[a-z0-9_]{1,32})?$/.test(database.schema)) throw Error("Restablecimiento permitido solo en un esquema bomberos_demo");
  const hash = await bcrypt.hash(password, 12), changed: string[] = [];
  for (const key of DEMO_LOGIN_KEYS) {
    const id = `demo_v2_${key}`, username = `demo.${key}`;
    const user = await tx.user.findUniqueOrThrow({ where: { id } });
    if (user.username !== username) throw Error(`Identidad demo modificada: ${key}; no se restablecieron credenciales`);
    if (await bcrypt.compare(password, user.passwordHash) && !user.mustChangePassword) continue;
    await tx.user.update({ where: { id }, data: { passwordHash: hash, mustChangePassword: false } });
    await tx.authSession.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    changed.push(username);
  }
  if (changed.length) await tx.auditLog.create({ data: {
    actorUserId: "demo_v2_admin", action: "SYSTEM_DEMO_CREDENTIALS_RESET", entityType: "System", entityId: "demo-credentials",
    metadata: { usernames: changed, reason: "Restablecimiento explicito de cuentas sinteticas; sesiones anteriores revocadas" },
  } });
  return changed;
}
