"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.rateLimit = rateLimit;
const buckets = new Map();
function getClientKey(req) {
    const forwardedFor = req.headers["x-forwarded-for"];
    const ip = typeof forwardedFor === "string"
        ? forwardedFor.split(",")[0]?.trim()
        : req.socket.remoteAddress;
    return `${req.method}:${req.path}:${ip || "unknown"}`;
}
function rateLimit(options) {
    return (req, res, next) => {
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
            res.setHeader("Retry-After", Math.ceil((existing.resetAt - now) / 1000).toString());
            return res.status(429).json({
                message: options.message || "Too many requests",
            });
        }
        next();
    };
}
