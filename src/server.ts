import { checkMigrations } from "./utils/migration-check";
import http from "http";
import { app } from "./app";
import { env } from "./config/env";
import { initSocket } from "./config/socket";
import { startControlReminderJob } from "./modules/members/control-reminder-job";
import { startPresenceTimeoutJob } from "./modules/members/presence-timeout-job";
import { startComplianceJobs } from "./modules/members/compliance-jobs";
import { startPushJob } from "./modules/push/push-job";

const server = http.createServer(app);

initSocket(server);

server.listen(env.port, () => {
  const stopReminders = startControlReminderJob();
  server.once("close", stopReminders);
  server.once("close", startPresenceTimeoutJob());
  server.once("close", startComplianceJobs());
  server.once("close", startPushJob());
  console.log(`Server running on port ${env.port}`);
  void checkMigrations();
});
