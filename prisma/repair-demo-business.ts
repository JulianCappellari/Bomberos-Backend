import "dotenv/config";
import { Prisma, PrismaClient } from "@prisma/client";

const ranks = [
  ["admin", "Comandante Mayor", "Administrador"], ["subjefe", "Comisario Inspector", "Oficial"],
  ["operador", "Sargento 1\u00ba", "Sub oficial"], ["oficial", "Oficial Principal", "Oficial"],
  ["bombero", "Bombero (Maquinista)", "Bombero"], ["sofia", "Bombero (Param\u00e9dica)", "Bombero"],
  ["nicolas", "Bombero (Forestal)", "Bombero"], ["camila", "Bombero (HazMat)", "Bombero"],
  ["inactivo", "Bombero (Licencia)", "Bombero"], ["pendiente", "Postulante", "Aspirante mayor"],
] as const;

export async function repairDemoBusiness(client: PrismaClient, apply = false) {
  if (process.env.NODE_ENV === "production") throw new Error("Reparacion demo prohibida en produccion");
  return client.$transaction(async (tx) => {
    const changes: Array<{ entityType: string; id: string; before: Prisma.InputJsonValue; after: Prisma.InputJsonValue }> = [];
    for (const [key, legacy, canonical] of ranks) {
      const userId = `demo_v2_${key}`;
      const profile = await tx.firefighterProfile.findUnique({ where: { userId }, select: { rank: true, updatedAt: true, user: { select: { username: true } } } });
      if (!profile || profile.rank !== legacy || profile.user.username !== `demo.${key}`) continue;
      changes.push({ entityType: "User", id: userId, before: { rank: profile.rank }, after: { rank: canonical } });
      if (apply && !(await tx.firefighterProfile.updateMany({ where: { userId, rank: legacy, updatedAt: profile.updatedAt }, data: { rank: canonical } })).count) throw new Error("El perfil cambio durante la reparacion");
    }
    const inspections = await tx.inspection.findMany({ where: { id: { in: Array.from({ length: 6 }, (_, index) => `demo_v2_inspection_${index}`) }, createdByUserId: "demo_v2_admin", vehicle: { assetId: { startsWith: "demo_v2_" } } }, include: { items: { select: { result: true } } } });
    for (const row of inspections) {
      const before = { summaryOk: row.summaryOk, summaryMissing: row.summaryMissing, summaryDamaged: row.summaryDamaged, summaryUnchecked: row.summaryUnchecked };
      const after = { summaryOk: row.items.filter((i) => i.result === "OK").length, summaryMissing: row.items.filter((i) => i.result === "MISSING").length, summaryDamaged: row.items.filter((i) => i.result === "DAMAGED").length, summaryUnchecked: row.items.filter((i) => i.result === "UNCHECKED").length };
      if (Object.keys(before).every((key) => before[key as keyof typeof before] === after[key as keyof typeof after])) continue;
      changes.push({ entityType: "Inspection", id: row.id, before, after });
      if (apply && !(await tx.inspection.updateMany({ where: { id: row.id, ...before }, data: after })).count) throw new Error("El control cambio durante la reparacion");
    }
    if (apply && changes.length) await tx.auditLog.create({ data: { action: "SYSTEM_DEMO_BUSINESS_REPAIRED", entityType: "System", entityId: "demo_v2", metadata: { changes } } });
    return { applied: apply, changes };
  }, { isolationLevel: "Serializable" });
}

if (require.main === module) {
  const client = new PrismaClient();
  repairDemoBusiness(client, process.argv.includes("--apply")).then((result) => console.log(JSON.stringify(result, null, 2))).catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => client.$disconnect());
}
