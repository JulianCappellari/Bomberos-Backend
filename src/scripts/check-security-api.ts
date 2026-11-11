import { purgeAuditLogs } from "../utils/audit-purge";
import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import bcrypt from "bcrypt";
import { isolatedApiTest } from "./isolated-api-test";
let app: typeof import("../app").app;
let prisma: typeof import("../config/prisma").prisma;
let initSocket: typeof import("../config/socket").initSocket;

async function main() {
  const run = randomUUID().slice(0, 8), ids: string[] = [], sessionIds: string[] = [], applicationIds: string[] = [];
  const password = `${randomUUID()}!Aa7`;
  const server = app.listen(0, "127.0.0.1");
  const io = initSocket(server);
  let checks = 0;
  try {
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address(); assert(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}`;
    const hash = await bcrypt.hash(password, 10);
    for (let index = 0; index < 3; index++) {
      const user = await prisma.user.create({ data: { username: `__security_${run}_${index}`, passwordHash: hash, role: index === 0 ? "ADMIN" : "FIREFIGHTER", mustChangePassword: index === 2 } });
      ids.push(user.id);
    }
    async function request(path: string, expected: number, method = "GET", body?: unknown, token?: string) {
      const response = await fetch(`${base}/api${path}`, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
      const data = await response.json(); assert.equal(response.status, expected, `${path}: ${JSON.stringify(data)}`); checks++;
      assert(!JSON.stringify(data).includes("passwordHash"), `${path} expone hashes`);
      return data;
    }
    const login = (index: number, pass = password) => request("/auth/login", 200, "POST", { username: `__security_${run}_${index}`, password: pass });
    const admin = await login(0), staff = await login(1), initial = await login(2);
    const adminToken = admin.tokens.accessToken;
    await request("/auth/me", 401, "GET", undefined, admin.tokens.refreshToken);
    await request("/auth/refresh", 401, "POST", { refreshToken: adminToken });
    await request("/auth/me", 401);
    await request("/users", 200, "GET", undefined, adminToken);
    await request("/users", 403, "GET", undefined, staff.tokens.accessToken);
    await request(`/users/${ids[0]}/toggle-active`, 400, "PATCH", {}, adminToken);
    const sessions = await request("/auth/sessions", 200, "GET", undefined, adminToken);
    const adminSession = sessions.find((s: { isCurrent: boolean }) => s.isCurrent); assert(adminSession);
    await request(`/auth/sessions/${adminSession.id}`, 200, "DELETE", undefined, staff.tokens.accessToken);
    await request("/auth/me", 200, "GET", undefined, adminToken);
    const application = await prisma.volunteerApplication.create({ data: { desiredUsername: `__security_${run}_approved`, fullName: "Aspirante temporal", dni: `S${run}`, phone: "TEMPORAL", address: "Temporal", emergencyContactName: "Contacto temporal", emergencyContactPhone: "TEMPORAL" } });
    applicationIds.push(application.id);
    const approvals = await Promise.all([0, 1].map(async () => {
      const response = await fetch(`${base}/api/applications/${application.id}/approve`, { method: "PATCH", headers: { Authorization: `Bearer ${adminToken}` } });
      return { status: response.status, data: await response.json() };
    }));
    assert.deepEqual(approvals.map((r) => r.status).sort(), [200, 400]); checks += 2;
    const approved = approvals.find((r) => r.status === 200)!.data;
    ids.push(approved.user.id);
    assert(!JSON.stringify(approved).includes("passwordHash"));
    assert(approved.initialPassword.length >= 24);
    assert.notEqual(approved.initialPassword, application.dni);
    const approvedLogin = await request("/auth/login", 200, "POST", { username: application.desiredUsername, password: approved.initialPassword });
    assert.equal(approvedLogin.user.mustChangePassword, true);
    await request("/users/roster", 403, "GET", undefined, approvedLogin.tokens.accessToken);
    const rotated = await request("/auth/refresh", 200, "POST", { refreshToken: staff.tokens.refreshToken });
    assert.notEqual(rotated.refreshToken, staff.tokens.refreshToken);
    await request("/auth/refresh", 401, "POST", { refreshToken: staff.tokens.refreshToken });
    await request("/auth/me", 401, "GET", undefined, rotated.accessToken);
    await request("/users/roster", 403, "GET", undefined, initial.tokens.accessToken);
    await request("/auth/change-password", 400, "PATCH", { currentPassword: password, newPassword: "short", confirmPassword: "short" }, initial.tokens.accessToken);
    const newPassword = `${randomUUID()}!Bb8`;
    await request("/auth/change-password", 200, "PATCH", { currentPassword: password, newPassword, confirmPassword: newPassword }, initial.tokens.accessToken);
    await request("/auth/me", 401, "GET", undefined, initial.tokens.accessToken);
    await request("/auth/login", 401, "POST", { username: `__security_${run}_2`, password });
    const changed = await login(2, newPassword);
    assert.equal(changed.user.mustChangePassword, false);
    await request("/users/roster", 200, "GET", undefined, changed.tokens.accessToken);
    await request("/auth/logout", 200, "POST", {}, changed.tokens.accessToken);
    await request("/auth/me", 401, "GET", undefined, changed.tokens.accessToken);
    const other = await login(0);
    await request("/auth/sessions", 200, "DELETE", undefined, adminToken);
    await request("/auth/me", 401, "GET", undefined, other.tokens.accessToken);
    await request("/auth/me", 200, "GET", undefined, adminToken);
    async function socketConnect(token?: string) {
      return new Promise<string>((resolve, reject) => {
        const ws = new WebSocket(`${base.replace("http:", "ws:")}/socket.io/?EIO=4&transport=websocket`);
        const timer = setTimeout(() => { ws.close(); reject(new Error("Socket timeout")); }, 5000);
        ws.onmessage = (event) => {
          const message = String(event.data);
          if (message.startsWith("0")) ws.send(`40${JSON.stringify(token ? { token } : {})}`);
          if (message.startsWith("40") || message.startsWith("44")) { clearTimeout(timer); ws.close(); resolve(message); }
        };
        ws.onerror = () => { clearTimeout(timer); reject(new Error("Socket error")); };
      });
    }
    assert((await socketConnect()).startsWith("44")); checks++;
    assert((await socketConnect(adminToken)).startsWith("40")); checks++;
    await request("/auth/logout", 200, "POST", {}, adminToken);
    assert((await socketConnect(adminToken)).startsWith("44")); checks++;
    console.log(`Seguridad API OK: ${checks} caminos; sesiones, permisos, rotacion, revocacion, claves y sockets.`);
  } finally {
    await prisma.volunteerApplication.deleteMany({ where: { id: { in: applicationIds } } });
    sessionIds.push(...(await prisma.authSession.findMany({ where: { userId: { in: ids } }, select: { id: true } })).map((s) => s.id));
    await purgeAuditLogs(prisma, { OR: [{ actorUserId: { in: ids } }, { entityId: { in: [...ids, ...sessionIds] } }] });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await new Promise<void>((resolve) => io.close(() => resolve()));
    await prisma.$disconnect();
  }
}
isolatedApiTest(async () => {
  ({ app } = await import("../app"));
  ({ prisma } = await import("../config/prisma"));
  ({ initSocket } = await import("../config/socket"));
  await main();
}).catch((error) => { console.error(error); process.exitCode = 1; });
