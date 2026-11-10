import { test } from "node:test";
import assert from "node:assert/strict";
import { canReadDeclarations, canReadPrivateProfile, messageFingerprint } from "../modules/members/members.service";
import { personalProfileSchema, periodSchema } from "../modules/members/members.schemas";
import { assertPresenceLocation, presenceDueAt, presenceSchema } from "../modules/members/presence.service";
import { effectiveAccessRole, guardFunctionAllowed } from "../utils/firefighter-ranks";
import { nextControlWeek } from "../modules/members/groups.service";
test("Perfil y prendas: titular y mando, no guardia ni otros usuarios", () => {
  const staff = { userId: "a", role: "FIREFIGHTER" }, sub = { userId: "b", role: "OPERATOR" }, admin = { userId: "c", role: "ADMIN" };
  assert(canReadPrivateProfile(staff, "a")); assert(!canReadPrivateProfile(staff, "b")); assert(canReadPrivateProfile(sub, "a"));
  assert(!canReadDeclarations(sub, "a", "CLOTHING")); assert(canReadDeclarations(sub, "a", "DRIVER_LICENSE")); assert(canReadDeclarations(admin, "a", "CLOTHING"));
  assert(!canReadDeclarations({ userId: "g", role: "GUARD" }, "a", "CLOTHING"));
});
test("El perfil personal no admite cambiar rol, cargo ni identidad", () => {
  const body = { phone: "", altPhone: "", address: "", bloodType: "", revision: new Date().toISOString(), emergencyContact: { fullName: "Contacto", phone: "555", relationship: "" } };
  assert(personalProfileSchema.safeParse(body).success);
  for (const extra of [{ role: "ADMIN" }, { rank: "Oficial" }, { userId: "otro" }]) assert(!personalProfileSchema.safeParse({ ...body, ...extra }).success);
});
test("El cargo oficial obtiene administracion; suboficial obtiene operacion", () => {
  assert.equal(effectiveAccessRole("FIREFIGHTER", "Oficial"), "ADMIN"); assert.equal(effectiveAccessRole("FIREFIGHTER", "Sub oficial"), "OPERATOR");
  for (const rank of ["Bombero", "Comision directiva", "Aspirante mayor", "Aspirante menor"]) assert.equal(effectiveAccessRole("FIREFIGHTER", rank), "FIREFIGHTER");
});
test("La función adicional de guardia exige habilitación y un cargo operativo", () => {
  for(const rank of ["Bombero","Oficial","Sub oficial","Sub-oficial"]) {
    assert(guardFunctionAllowed(true,rank));
    assert(!guardFunctionAllowed(false,rank));
  }
  for(const rank of ["Administrador","Aspirante menor","Aspirante mayor","Comision directiva","Guardia"])assert(!guardFunctionAllowed(true,rank));
});
test("Una edicion cambia la huella del mensaje y exige otro acuse", () => {
  const message = { id: "m", body: "Texto", createdAt: new Date("2026-01-01"), editedAt: null };
  assert.notEqual(messageFingerprint(message), messageFingerprint({ ...message, body: "Editado" }));
  assert.notEqual(messageFingerprint(message), messageFingerprint({ ...message, editedAt: new Date("2026-01-02") }));
});
test("Disponibilidad no admite periodos invertidos", () => {
  assert(!periodSchema.safeParse({ startsAt: "2026-01-02T00:00:00Z", endsAt: "2026-01-01T00:00:00Z" }).success);
});
test("Revalidacion vence a los treinta minutos y exige GPS reciente de 100m", () => {
  const now = new Date("2026-01-01T12:00:00Z");
  assert.equal(presenceDueAt({ checkInAt: now })!.getTime() - now.getTime(), 1800000);
  const point = { latitude: -33, longitude: -64, accuracy: 10, capturedAt: now.toISOString() };
  assert.equal(assertPresenceLocation(point, { latitude: -33, longitude: -64 }, now), 0);
  assert.throws(() => assertPresenceLocation({ ...point, latitude: -34 }, { latitude: -33, longitude: -64 }, now));
  assert.throws(() => assertPresenceLocation({ ...point, accuracy: 60 }, { latitude: -33, longitude: -64 }, now));
  assert.throws(() => assertPresenceLocation({ ...point, capturedAt: "2026-01-01T10:00:00Z" }, { latitude: -33, longitude: -64 }, now));
  assert(!presenceSchema.safeParse({ inside: true, attendanceId: "a" }).success);
});
test("La rotacion conserva la semana vigente y calcula la siguiente", () => {
  const anchor = new Date("2026-01-05");
  assert.equal(nextControlWeek(anchor, 4, new Date("2026-01-07")).current, true);
  assert.equal(nextControlWeek(anchor, 4, new Date("2026-01-15")).start.toISOString().slice(0, 10), "2026-02-02");
  assert.equal(nextControlWeek(anchor, 4, new Date("2026-01-01")).start.getTime(), anchor.getTime());
});
