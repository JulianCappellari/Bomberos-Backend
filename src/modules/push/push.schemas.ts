import { z } from "zod";
import { ECDH } from "node:crypto";

// Endpoints are capability URLs. Never allow an arbitrary URL to become a server-side request.
const hosts = new Set(["fcm.googleapis.com", "updates.push.services.mozilla.com", "web.push.apple.com"]);
export function trustedPushEndpoint(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.hash && !url.port && hosts.has(url.hostname) && url.pathname.length > 1;
  } catch { return false; }
}
function key(value: string, length: number) {
  return /^[A-Za-z0-9_-]+$/.test(value) && Buffer.from(value, "base64url").length === length;
}
function publicKey(value: string) {
  if (!key(value, 65) || Buffer.from(value, "base64url")[0] !== 4) return false;
  try { ECDH.convertKey(Buffer.from(value, "base64url"), "prime256v1"); return true; } catch { return false; }
}
export const subscriptionSchema = z.object({
  endpoint: z.string().max(2048).refine(trustedPushEndpoint, "Proveedor de notificaciones no admitido"),
  expirationTime: z.number().positive().nullable().optional(),
  keys: z.object({
    p256dh: z.string().max(100).refine(publicKey, "Clave de dispositivo invalida"),
    auth: z.string().max(50).refine(v => key(v, 16), "Autenticacion de dispositivo invalida"),
  }).strict(),
}).strict();

export function pushPolicy(href: string) {
  const alert = /^\/alerts(?:\/|\?|$)/.test(href);
  return { maxAgeMs: (alert ? 15 * 60 : 24 * 60 * 60) * 1000, urgency: alert ? "high" as const : "normal" as const, alert };
}
export function retryDelay(attempts: number) { return Math.min(15 * 60000, 30000 * 2 ** Math.max(0, attempts - 1)); }
