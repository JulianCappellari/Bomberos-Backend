import { readdir } from "node:fs/promises";
import path from "node:path";
import { Prisma } from "@prisma/client";
import { prisma } from "../config/prisma";
import { qualifiedTable } from "./database-schema";

// Al publicar codigo nuevo hay que aplicar sus migraciones a la base. Si se olvida, las consultas fallan con
// "columna inexistente" y el usuario solo ve "error interno". Este control lo detecta al arrancar.
export type MigrationStatus = { checkedAt: string; pending: string[]; error?: string };
let status: MigrationStatus = { checkedAt: new Date(0).toISOString(), pending: [] };
export const migrationStatus = () => status;

export async function checkMigrations() {
  try {
    const dir = path.resolve(process.cwd(), "prisma", "migrations");
    const local = (await readdir(dir, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name).sort();
    const applied = new Set((await prisma.$queryRaw<Array<{ migration_name: string }>>(Prisma.sql`SELECT migration_name FROM ${qualifiedTable("_prisma_migrations")} WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`)).map((r) => r.migration_name));
    status = { checkedAt: new Date().toISOString(), pending: local.filter((name) => !applied.has(name)) };
    if (status.pending.length) {
      console.error(`\n*** BASE DE DATOS DESACTUALIZADA: faltan ${status.pending.length} migraciones ***\n${status.pending.map((n) => `  - ${n}`).join("\n")}\nAplicalas con "npm run prisma:migrate:demo" (esquema demo) o "npx prisma migrate deploy" antes de usar el sistema.\n`);
    }
  } catch (error) {
    status = { checkedAt: new Date().toISOString(), pending: [], error: error instanceof Error ? error.message.slice(0, 200) : "desconocido" };
    console.error("No se pudo verificar el estado de las migraciones", status.error);
  }
  return status;
}
