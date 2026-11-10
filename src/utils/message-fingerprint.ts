import { createHash } from "node:crypto";
export function messageFingerprint(message: { id: string; body: string; editedAt: Date | null; createdAt: Date }) {
  return createHash("sha256").update(JSON.stringify([message.id, message.body, (message.editedAt || message.createdAt).toISOString()])).digest("hex");
}
