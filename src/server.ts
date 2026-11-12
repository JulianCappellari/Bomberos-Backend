import { checkMigrations } from "./utils/migration-check";
import http from "http";
import { app } from "./app";
import { env } from "./config/env";
import { initSocket } from "./config/socket";
import { startControlReminderJob } from "./modules/members/control-reminder-job";
import { startPresenceTimeoutJob } from "./modules/members/presence-timeout-job";
import { startComplianceJobs } from "./modules/members/compliance-jobs";
import { startPushJob } from "./modules/push/push-job";
import { syncDriverRequests } from "./modules/incidents/driver-authorizations";
import { prisma } from "./config/prisma";

const server = http.createServer(app);

initSocket(server);

server.listen(env.port, () => {
  const stopReminders = startControlReminderJob();
  server.once("close", stopReminders);
  server.once("close", startPresenceTimeoutJob());
  // Pedidos de habilitacion de conductor para licencias ya cargadas (idempotente).
  void prisma.$transaction((tx) => syncDriverRequests(tx), { timeout: 30000 }).catch(() => console.error("No se pudieron generar los pedidos de habilitación de conductor"));
  server.once("close", startComplianceJobs());
  server.once("close", startPushJob());
  console.log(`Server running on port ${env.port}`);
  void checkMigrations();
});
