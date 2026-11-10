"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.signalPresenceChanged = signalPresenceChanged;
exports.observePresenceChanges = observePresenceChanges;
exports.presenceEventStream = presenceEventStream;
const node_events_1 = require("node:events");
const events = new node_events_1.EventEmitter();
events.setMaxListeners(0);
function signalPresenceChanged() { events.emit("changed"); }
function observePresenceChanges(req, res, next) {
    res.once("finish", () => {
        const path = req.originalUrl.split("?")[0];
        if (res.statusCode < 400 && req.user && !["GET", "HEAD", "OPTIONS"].includes(req.method) && (path.startsWith("/api/attendance/") || path === "/api/members/presence" || path.startsWith("/api/users/")))
            events.emit("changed");
    });
    next();
}
function presenceEventStream(req, res) {
    res.status(200).set({ "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive", "X-Accel-Buffering": "no" });
    res.flushHeaders();
    const changed = () => { if (!res.destroyed)
        res.write("event: changed\ndata: refresh\n\n"); };
    events.on("changed", changed);
    res.write("event: ready\ndata: connected\n\n");
    const heartbeat = setInterval(() => { if (!res.destroyed)
        res.write(": heartbeat\n\n"); }, 15000);
    // Short-lived subscriptions reauthenticate instead of outliving account revocation.
    const expiry = setTimeout(() => res.end(), 45000);
    req.once("close", () => { events.off("changed", changed); clearInterval(heartbeat); clearTimeout(expiry); });
}
