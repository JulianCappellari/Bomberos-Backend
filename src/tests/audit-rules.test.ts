import { test } from "node:test";
import assert from "node:assert/strict";
import { auditActorRequired } from "../utils/audit-rules";
test("La auditoria admite accesos anonimos denegados sin inventar un actor", () => {
  for (const status of [401, 403]) assert.equal(auditActorRequired("HTTP_ACCESS_DENIED", "HttpRequest", { status }), false);
  for (const metadata of [null, {}, { status: 200 }, { status: "otro" }]) assert.equal(auditActorRequired("HTTP_ACCESS_DENIED", "HttpRequest", metadata), true);
});
test("Las mutaciones operativas siguen exigiendo actor", () => {
  assert.equal(auditActorRequired("HTTP_MUTATION", "HttpRequest", { status: 403 }), true);
  assert.equal(auditActorRequired("DOCUMENT_CREATED", "OperationalDocument", {}), true);
  assert.equal(auditActorRequired("HTTP_ACCESS_DENIED", "User", { status: 401 }), true);
});
test("Los procesos de sistema conservan su excepcion explicita", () => {
  assert.equal(auditActorRequired("SYSTEM_PRESENCE_EXPIRED", "Attendance", {}), false);
  assert.equal(auditActorRequired("SEED_LOADED", "System", {}), false);
});
