import { NextFunction, Request, Response } from "express";

type Bucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, Bucket>();

function getClientKey(req: Request) {
  const forwardedFor = req.headers["x-forwarded-for"];
  const ip =
    typeof forwardedFor === "string"
      ? forwardedFor.split(",")[0]?.trim()
      : req.socket.remoteAddress;

  return `${req.method}:${req.path}:${ip || "unknown"}`;
}

export function rateLimit(options: {
  windowMs: number;
  maxRequests: number;
  message?: string;
}) {
  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    const key = getClientKey(req);
    const existing = buckets.get(key);

    if (!existing || existing.resetAt <= now) {
      buckets.set(key, {
        count: 1,
        resetAt: now + options.windowMs,
      });
      next();
      return;
    }

    existing.count += 1;

    if (existing.count > options.maxRequests) {
      res.setHeader(
        "Retry-After",
        Math.ceil((existing.resetAt - now) / 1000).toString(),
      );
      return res.status(429).json({
        message: options.message || "Too many requests",
      });
    }

    next();
  };
}
