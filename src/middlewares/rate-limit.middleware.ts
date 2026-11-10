import { NextFunction, Request, Response } from "express";
type Bucket = { count: number; resetAt: number };
export function clientRateLimitKey(req: Request) {
  // Express only trusts proxies explicitly configured by the deployment.
  return (req.ip || req.socket.remoteAddress || "unknown").replace(/^::ffff:/, "");
}
export function rateLimit(options: { windowMs: number; maxRequests: number; message?: string }) {
  const buckets = new Map<string, Bucket>();
  let nextCleanup = 0;
  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    if (now >= nextCleanup) {
      for (const [key, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(key);
      nextCleanup = now + Math.min(options.windowMs, 60000);
    }
    const key = clientRateLimitKey(req);
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      if (!bucket && buckets.size >= 10000) return res.status(429).json({ message: "Demasiadas solicitudes. Intente mas tarde." });
      bucket = { count: 0, resetAt: now + options.windowMs };
      buckets.set(key, bucket);
    }
    bucket.count++;
    res.setHeader("RateLimit-Limit", options.maxRequests);
    res.setHeader("RateLimit-Remaining", Math.max(0, options.maxRequests - bucket.count));
    if (bucket.count > options.maxRequests) {
      res.setHeader("Retry-After", Math.ceil((bucket.resetAt - now) / 1000));
      return res.status(429).json({ message: options.message || "Too many requests" });
    }
    next();
  };
}
