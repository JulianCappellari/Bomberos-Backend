import "dotenv/config";
import { execFileSync } from "node:child_process";
if (process.env.NODE_ENV === "production") throw new Error("No ejecutar demostraciones en produccion");
if (!process.env.DATABASE_URL) throw new Error("Configure DATABASE_URL para su PostgreSQL de desarrollo");
const schema = process.env.SEED_SCHEMA || "bomberos_demo";
if (!/^bomberos_demo(?:_[a-z0-9_]{1,32})?$/.test(schema)) throw new Error("SEED_SCHEMA debe ser bomberos_demo o bomberos_demo_<sufijo seguro>");
const url = new URL(process.env.DATABASE_URL); url.searchParams.set("schema", schema);
const reset = process.argv.includes("--reset-passwords");
if (process.argv.slice(2).some(arg => arg !== "--reset-passwords")) throw Error("Opcion desconocida. Use --reset-passwords para restablecer las nueve cuentas principales.");
const env = { ...process.env, NODE_ENV: "development", DATABASE_URL: url.toString(), SEED_DEMO: "true", SEED_RESET_DEMO_PASSWORDS: reset ? "true" : "false" };
console.log(`Preparando exclusivamente el esquema ${schema}. No se modifica public ni se elimina ningun esquema.`);
try {
  execFileSync(process.execPath, [require.resolve("prisma/build/index.js"), "migrate", "deploy"], { env, stdio: "inherit" });
  execFileSync(process.execPath, [require.resolve("tsx/cli"), "prisma/seed.ts"], { env, stdio: "inherit" });
  console.log(`Para usar la demo, configure schema=${schema} en DATABASE_URL del backend y reinicielo. No se modifico su archivo .env.`);
} catch { console.error("La preparacion de la demo fallo; no se eliminaron bases ni esquemas. Revise el error anterior."); process.exitCode = 1; }
