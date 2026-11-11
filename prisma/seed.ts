import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { seedDemo } from "./demo-data";
import { effectiveAccessRole } from "../src/utils/firefighter-ranks";
import { DEMO_PASSWORD, DEMO_LOGIN_KEYS } from "./demo-credentials";

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("Seed de demostracion prohibido en produccion");
  const password = process.env.SEED_PASSWORD || DEMO_PASSWORD;
  const prisma = new PrismaClient();
  try {
    const before = new Set((await prisma.user.findMany({ select: { id: true } })).map((row) => row.id));
    console.log("Seed de demostracion: datos sinteticos, no utilizar en operaciones reales.");
    const resetPasswords = process.env.SEED_RESET_DEMO_PASSWORDS === "true";
    const { extended, questionnaire, ...counts } = await seedDemo(prisma, password, { resetPasswords });
    console.table(counts);
    console.log(extended.note);
    console.log(`Cuestionario: ${questionnaire.convocados} convocados sinteticos; escenarios ${questionnaire.primeraVez === "sí" ? "creados" : "conservados"}.`);
    console.log("Guia de cuentas, escenarios y resultados esperados: GUIA_SEED_PROFESIONAL.md");
    console.log("Las fechas quedan ancladas a la primera carga; repetir el seed no reabre tareas, pagos o asistencias ya resueltas.");
    const users = await prisma.user.findMany({ where: { id: { startsWith: "demo_v2_" } }, include: { profile: true }, orderBy: { username: "asc" } });
    const created = users.filter((row) => !before.has(row.id));
    console.table(users.map((row) => ({ usuario: row.username, cargo: row.profile?.rank, acceso: effectiveAccessRole(row.role, row.profile?.rank), estado: row.deletedAt ? "Baja" : row.isPendingApproval ? "Pendiente" : row.isActive ? "Activo" : "Pausado", cambioClave: row.mustChangePassword, nueva: !before.has(row.id) })));
    if (created.length) { console.log(`Clave inicial SOLO para las ${created.length} cuentas nuevas: ${password}`); console.log("Credencial exclusiva de demo. No reutilizar en produccion."); }
    else if (!resetPasswords) console.log("No se crearon cuentas nuevas. Se conservan las claves y permisos existentes.");
    if (resetPasswords) {
      console.log(`Clave verificada para ${DEMO_LOGIN_KEYS.map(key => `demo.${key}`).join(", ")}: ${password}`);
      console.log("No se cambiaron cargos ni estados. Se revocaron las sesiones de cuentas cuya clave cambio. Solo para demo.");
    }
  } finally { await prisma.$disconnect(); }
}
main().catch((error) => { console.error("No se pudo completar el seed:", error.message); process.exitCode = 1; });
