import { randomUUID } from "node:crypto";
import { Request, Response, NextFunction } from "express";
import { prisma } from "../config/prisma";
const pending = new Set<Promise<unknown>>();
export async function flushRequestAudit() { await Promise.all([...pending]); }
export function requestAudit(req: Request, res: Response, next: NextFunction) {
  const requestId = randomUUID();
  res.setHeader("X-Request-ID", requestId);
  res.once("finish", () => {
    const denied = res.statusCode === 401 || res.statusCode === 403;
    const mutation = !["GET", "HEAD", "OPTIONS"].includes(req.method);
    if (!denied && (!mutation || !req.user)) return;
    // Never retain request bodies, query strings, credentials or GPS in HTTP traces.
    const route = `${req.baseUrl || "/api"}${typeof req.route?.path === "string" ? req.route.path : ""}`.slice(0, 200);
    const work = prisma.auditLog.create({ data: { actorUserId: req.user?.userId || null, action: denied ? "HTTP_ACCESS_DENIED" : "HTTP_MUTATION", entityType: "HttpRequest", entityId: requestId, metadata: { method: req.method, route, status: res.statusCode } } }).catch(() => { console.error("HTTP audit persistence failed", { requestId }); });
    pending.add(work); void work.finally(() => pending.delete(work));
  });
  next();
}
