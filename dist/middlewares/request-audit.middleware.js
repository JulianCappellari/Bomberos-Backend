"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.flushRequestAudit = flushRequestAudit;
exports.requestAudit = requestAudit;
const node_crypto_1 = require("node:crypto");
const prisma_1 = require("../config/prisma");
const pending = new Set();
async function flushRequestAudit() { await Promise.all([...pending]); }
function requestAudit(req, res, next) {
    const requestId = (0, node_crypto_1.randomUUID)();
    res.setHeader("X-Request-ID", requestId);
    res.once("finish", () => {
        const denied = res.statusCode === 401 || res.statusCode === 403;
        const mutation = !["GET", "HEAD", "OPTIONS"].includes(req.method);
        if (!denied && (!mutation || !req.user))
            return;
        // Never retain request bodies, query strings, credentials or GPS in HTTP traces.
        const route = `${req.baseUrl || "/api"}${typeof req.route?.path === "string" ? req.route.path : ""}`.slice(0, 200);
        const work = prisma_1.prisma.auditLog.create({ data: { actorUserId: req.user?.userId || null, action: denied ? "HTTP_ACCESS_DENIED" : "HTTP_MUTATION", entityType: "HttpRequest", entityId: requestId, metadata: { method: req.method, route, status: res.statusCode } } }).catch(() => { console.error("HTTP audit persistence failed", { requestId }); });
        pending.add(work);
        void work.finally(() => pending.delete(work));
    });
    next();
}
