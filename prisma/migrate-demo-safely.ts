import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

async function main() {
  const url = new URL(process.env.DATABASE_URL!);
  const schema = url.searchParams.get("schema") || "public";
  if (process.env.NODE_ENV === "production" || !/^bomberos_demo(?:_[a-z0-9_]{1,32})?$/.test(schema)) throw Error("Este comando solo aplica migraciones al esquema demo configurado; no modifica public");
  const db = new PrismaClient();
  try {
    const applied = await db.$queryRaw<Array<{ migration_name: string }>>`SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`;
    if (!applied.some(row => row.migration_name === "202611100004_business_rules_alignment")) {
      const rows = await db.attendance.findMany({ where: { status: "CLOSED", checkOutTrust: null, promptShownAt: { not: null }, checkOutAt: { not: null } }, select: { id: true, userId: true, workedMinutes: true, checkInAt: true, checkOutAt: true } });
      const directory = path.resolve(__dirname, "../../tmp/migrations"); await mkdir(directory, { recursive: true });
      const file = path.join(directory, `presencias-antes-E08-${Date.now()}.json`);
      await writeFile(file, JSON.stringify({ schema, createdAt: new Date().toISOString(), rule: "E08: descartar permanencias cerradas por vencimiento", attendanceBefore: rows }, null, 2), { flag: "wx" });
      console.log(`Respaldo de ${rows.length} permanencias que la migracion descartara: ${file}`);
    }
    console.log(`Aplicando migraciones exclusivamente en ${schema}; no se ejecuta el seed ni se cambian claves.`);
    execFileSync(process.execPath, [require.resolve("prisma/build/index.js"), "migrate", "deploy"], { env: process.env, stdio: "inherit" });
  } finally { await db.$disconnect(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
