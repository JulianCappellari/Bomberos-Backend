import assert from "node:assert/strict";
import test from "node:test";
import type { Request, Response } from "express";
import { rateLimit } from "../middlewares/rate-limit.middleware";
import { changePasswordSchema, loginSchema } from "../modules/auth/auth.schemas";

test("Las claves nuevas respetan el limite de bytes de bcrypt", () => {
  const password = "a".repeat(12);
  assert(changePasswordSchema.safeParse({ currentPassword: "old", newPassword: password, confirmPassword: password }).success);
  assert(!changePasswordSchema.safeParse({ currentPassword: "old", newPassword: "short", confirmPassword: "short" }).success);
  const unicode = "\u00e1".repeat(40);
  assert(!changePasswordSchema.safeParse({ currentPassword: "old", newPassword: unicode, confirmPassword: unicode }).success);
  assert(!loginSchema.safeParse({ username: "user", password: "a".repeat(1025) }).success);
});

test("Cambiar X-Forwarded-For no permite evadir el limite de intentos", () => {
  const limit = rateLimit({ windowMs: 60000, maxRequests: 2 });
  for (const [index, expected] of [200, 200, 429].entries()) {
    let status = 200, nextCalls = 0;
    const headers = new Map<string, unknown>();
    const req = { ip: "127.0.0.1", socket: { remoteAddress: "127.0.0.1" }, headers: { "x-forwarded-for": `192.0.2.${index}` } } as unknown as Request;
    const res = { setHeader: (key: string, value: unknown) => headers.set(key, value), status: (value: number) => { status = value; return res; }, json: () => res } as unknown as Response;
    limit(req, res, () => { nextCalls++; });
    assert.equal(status, expected);
    assert.equal(nextCalls, expected === 429 ? 0 : 1);
    if (expected === 429) assert(Number(headers.get("Retry-After")) > 0);
  }
});
