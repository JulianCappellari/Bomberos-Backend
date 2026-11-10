import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
export async function isolatedApiTest(run: () => Promise<void>) {
  if (process.env.NODE_ENV === "production") throw new Error("Prueba no autorizada en produccion");
  const original = process.env.DATABASE_URL!;
  const schema = `api_verify_${randomBytes(8).toString("hex")}`;
  const url = new URL(original); url.searchParams.set("schema", schema);
  const root = new PrismaClient({ datasourceUrl: original }); let initialized = false;
  try {
    execFileSync(process.execPath, [require.resolve("prisma/build/index.js"), "migrate", "deploy"], { env: { ...process.env, DATABASE_URL: url.toString() }, stdio: "pipe" });
    process.env.DATABASE_URL = url.toString(); initialized = true;
    await run();
  } finally {
    if (initialized) { const { prisma } = await import("../config/prisma"); await prisma.$disconnect(); }
    process.env.DATABASE_URL = original;
    if (!/^api_verify_[a-f0-9]{16}$/.test(schema)) throw new Error("Nombre temporal invalido");
    await root.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await root.$disconnect();
  }
}
