"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const http_1 = __importDefault(require("http"));
const app_1 = require("./app");
const env_1 = require("./config/env");
const socket_1 = require("./config/socket");
const control_reminder_job_1 = require("./modules/members/control-reminder-job");
const presence_timeout_job_1 = require("./modules/members/presence-timeout-job");
const compliance_jobs_1 = require("./modules/members/compliance-jobs");
const push_job_1 = require("./modules/push/push-job");
const server = http_1.default.createServer(app_1.app);
(0, socket_1.initSocket)(server);
server.listen(env_1.env.port, () => {
    const stopReminders = (0, control_reminder_job_1.startControlReminderJob)();
    server.once("close", stopReminders);
    server.once("close", (0, presence_timeout_job_1.startPresenceTimeoutJob)());
    server.once("close", (0, compliance_jobs_1.startComplianceJobs)());
    server.once("close", (0, push_job_1.startPushJob)());
    console.log(`Server running on port ${env_1.env.port}`);
});
