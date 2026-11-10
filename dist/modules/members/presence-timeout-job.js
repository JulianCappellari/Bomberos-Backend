"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startPresenceTimeoutJob = startPresenceTimeoutJob;
const prisma_1 = require("../../config/prisma");
const presence_service_1 = require("./presence.service");
const presence_events_1 = require("../attendance/presence-events");
function startPresenceTimeoutJob() {
    let running = false;
    async function sweep() {
        if (running)
            return;
        running = true;
        try {
            const now = new Date(), cutoff = new Date(+now - 30 * 60000);
            let after = "";
            for (;;) {
                const rows = await prisma_1.prisma.attendance.findMany({ where: { status: "OPEN", promptShownAt: { lte: cutoff }, id: { gt: after } }, select: { id: true }, orderBy: { id: "asc" }, take: 100 });
                for (const { id } of rows)
                    if (await (0, presence_service_1.expirePresence)(id, now))
                        (0, presence_events_1.signalPresenceChanged)();
                if (rows.length < 100)
                    break;
                after = rows[rows.length - 1].id;
            }
        }
        catch {
            console.error("No se pudo completar el control de permanencias; se reintentará");
        }
        finally {
            running = false;
        }
    }
    void sweep();
    const timer = setInterval(() => void sweep(), 60000);
    timer.unref();
    return () => clearInterval(timer);
}
