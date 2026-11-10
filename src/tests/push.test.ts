import test from "node:test";
import assert from "node:assert/strict";
import { createECDH, randomBytes } from "node:crypto";
import { trustedPushEndpoint, subscriptionSchema, retryDelay, pushPolicy } from "../modules/push/push.schemas";
test("push endpoints only allow HTTPS on trusted providers, never an arbitrary host", () => {
  for (const host of ["fcm.googleapis.com", "updates.push.services.mozilla.com", "web.push.apple.com"]) assert(trustedPushEndpoint(`https://${host}/push/capability`));
  for (const value of ["http://fcm.googleapis.com/push", "https://localhost/push", "https://127.0.0.1/push", "https://fcm.googleapis.com.evil.example/push", "https://fcm.googleapis.com:4000/push", "https://user@fcm.googleapis.com/push", "https://fcm.googleapis.com/push#fragment", "file:///etc/hosts"]) assert(!trustedPushEndpoint(value), value);
});
test("push subscription validates uncompressed P256 and 16-byte auth, rejects extra fields", () => {
  const pair = createECDH("prime256v1"); pair.generateKeys();
  const input = { endpoint: "https://web.push.apple.com/test", keys: { p256dh: pair.getPublicKey().toString("base64url"), auth: randomBytes(16).toString("base64url") } };
  assert(subscriptionSchema.safeParse(input).success);
  assert(!subscriptionSchema.safeParse({ ...input, keys: { ...input.keys, auth: "short" } }).success);
  assert(!subscriptionSchema.safeParse({ ...input, userId: "someone-else" }).success);
});
test("emergency messages expire quickly and retries are bounded", () => {
  assert.equal(pushPolicy("/alerts").maxAgeMs, 900000);
  assert.equal(pushPolicy("/notifications").maxAgeMs, 86400000);
  assert(!pushPolicy("/alerts-untrusted").alert);
  assert.equal(retryDelay(1), 30000); assert.equal(retryDelay(5), 480000); assert.equal(retryDelay(100), 900000);
});
