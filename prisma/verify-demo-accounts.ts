import "dotenv/config";
import assert from "node:assert/strict";
import { DEMO_LOGIN_KEYS, DEMO_PASSWORD } from "./demo-credentials";

async function main() {
  const url = new URL(process.env.DATABASE_URL!);
  if (process.env.NODE_ENV === "production" || !/^bomberos_demo(?:_[a-z0-9_]{1,32})?$/.test(url.searchParams.get("schema") || "")) throw Error("Verificacion solo para esquemas bomberos_demo");
  const { app } = await import("../src/app");
  const { prisma } = await import("../src/config/prisma");
  const { verifyAccessToken } = await import("../src/utils/jwt");
  const { flushRequestAudit } = await import("../src/middlewares/request-audit.middleware");
  const server = app.listen(0, "127.0.0.1"), sessions: string[] = [];
  try {
    await new Promise<void>(resolve => server.once("listening", resolve));
    const address = server.address(); assert(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}/api/auth`, results = [];
    for (const key of DEMO_LOGIN_KEYS) {
      const username = `demo.${key}`;
      // El ingreso admite 10 intentos por minuto: con mas cuentas se espera el minuto en lugar de fallar.
      const login = () => fetch(base + "/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password: process.env.SEED_PASSWORD || DEMO_PASSWORD }) });
      let response = await login();
      if (response.status === 429) { console.log("Límite de ingresos por minuto: esperando 61 s para seguir verificando."); await new Promise(resolve => setTimeout(resolve, 61_000)); response = await login(); }
      const data = await response.json();
      assert.equal(response.status, 200, `No pudo iniciar sesion ${username}: HTTP ${response.status}`);
      assert.equal(data.user.username, username); assert.equal(data.user.mustChangePassword, false);
      sessions.push(verifyAccessToken(data.tokens.accessToken).sessionId);
      const logout = await fetch(base + "/logout", { method: "POST", headers: { Authorization: `Bearer ${data.tokens.accessToken}` } });
      assert.equal(logout.status, 200, `No pudo cerrar la sesion de prueba de ${username}`);
      results.push({ usuario: username, acceso: data.user.role, resultado: "Ingreso y cierre correctos" });
    }
    console.table(results);
    console.log(`Las ${DEMO_LOGIN_KEYS.length} cuentas ingresan por la API. No se conservan sesiones de esta verificacion.`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await flushRequestAudit();
    await prisma.authSession.updateMany({ where: { id: { in: sessions }, revokedAt: null }, data: { revokedAt: new Date() } });
    await prisma.$disconnect();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
