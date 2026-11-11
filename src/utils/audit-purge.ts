import { Prisma, PrismaClient } from "@prisma/client";

// La auditoria es inalterable (trigger en la base). Solo se purga de forma explicita, dentro de una
// transaccion que activa "bomberos.audit_purge": limpieza de pruebas o politicas de retencion.
export async function purgeAuditLogs(client: PrismaClient, where: Prisma.AuditLogWhereInput) {
  return client.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('bomberos.audit_purge', 'on', true)`;
    return tx.auditLog.deleteMany({ where });
  });
}
