"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startControlReminderJob = startControlReminderJob;
const prisma_1 = require("../../config/prisma");
const groups_service_1 = require("./groups.service");
function startControlReminderJob() {
    let running = false;
    async function run() {
        if (running)
            return;
        running = true;
        try {
            let cursor;
            do {
                const members = await prisma_1.prisma.controlGroupMember.findMany({ where: { user: { isActive: true, isPendingApproval: false, deletedAt: null } }, select: { userId: true }, orderBy: { userId: "asc" }, take: 100, ...(cursor ? { cursor: { userId: cursor }, skip: 1 } : {}) });
                for (const member of members)
                    await (0, groups_service_1.syncControlReminder)(member.userId);
                cursor = members.length === 100 ? members[members.length - 1].userId : undefined;
            } while (cursor);
        }
        catch {
            console.error("Control reminder job failed; will retry");
        }
        finally {
            running = false;
        }
    }
    void run();
    const timer = setInterval(() => void run(), 60000);
    timer.unref();
    return () => clearInterval(timer);
}
