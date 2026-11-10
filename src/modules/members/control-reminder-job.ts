import { prisma } from "../../config/prisma";
import { syncControlReminder } from "./groups.service";
export function startControlReminderJob() {
  let running = false;
  async function run() {
    if (running) return;
    running = true;
    try {
      let cursor: string | undefined;
      do {
        const members = await prisma.controlGroupMember.findMany({ where: { user: { isActive: true, isPendingApproval: false, deletedAt: null } }, select: { userId: true }, orderBy: { userId: "asc" }, take: 100, ...(cursor ? { cursor: { userId: cursor }, skip: 1 } : {}) });
        for (const member of members) await syncControlReminder(member.userId);
        cursor = members.length === 100 ? members[members.length - 1]!.userId : undefined;
      } while (cursor);
    } catch { console.error("Control reminder job failed; will retry"); }
    finally { running = false; }
  }
  void run();
  const timer = setInterval(() => void run(), 60000); timer.unref();
  return () => clearInterval(timer);
}
