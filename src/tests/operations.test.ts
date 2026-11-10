import assert from "node:assert/strict";
import { test } from "node:test";
import { Prisma } from "@prisma/client";
import {
  availabilitySchema, maintenanceSchema, maintenanceTransitionSchema, createDocumentSchema,
  assertMaintenanceTransition, assertDocumentTransition, isOperationsManager,
} from "../modules/operations/operations.schemas";
import { saveAvailability } from "../modules/operations/availability.service";
import { serializable } from "../utils/transaction";
import { prisma } from "../config/prisma";

test("Solo administradores y operadores gestionan operaciones", () => {
  assert.equal(isOperationsManager("ADMIN"), true);
  assert.equal(isOperationsManager("OPERATOR"), true);
  assert.equal(isOperationsManager("FIREFIGHTER"), false);
});
test("La disponibilidad requiere un turno y estado conocidos", () => {
  assert.equal(availabilitySchema.safeParse({ date: "2099-01-01", period: "DAY", status: "AVAILABLE" }).success, true);
  assert.equal(availabilitySchema.safeParse({ date: "2099-01-01", period: "OTHER", status: "AVAILABLE" }).success, false);
});
test("Un bombero no puede modificar disponibilidad ajena", async () => {
  await assert.rejects(saveAvailability({
    userId: "other", date: "2099-01-01", period: "DAY", status: "UNAVAILABLE", revision: 0,
  }, { userId: "self", role: "FIREFIGHTER" }), (error: any) => error.status === 403);
});
test("La disponibilidad historica queda en modo de solo lectura", async () => {
  await assert.rejects(saveAvailability({
    date: "2000-01-01", period: "DAY", status: "AVAILABLE", revision: 0,
  }, { userId: "self", role: "ADMIN" }), (error: any) => error.status === 400);
});
test("Los trabajos requieren descripcion y no admiten costos negativos", () => {
  assert.equal(maintenanceSchema.safeParse({ assetId: "a", title: "Motor", description: "x" }).success, false);
  assert.equal(maintenanceTransitionSchema.safeParse({ status: "RESOLVED", revision: 1, resolution: "Trabajo realizado", costCents: -1 }).success, false);
});
test("Cerrar o cancelar mantenimiento exige una resolucion", () => {
  assert.equal(maintenanceTransitionSchema.safeParse({ status: "RESOLVED", revision: 1 }).success, false);
  assert.equal(maintenanceTransitionSchema.safeParse({ status: "CANCELLED", revision: 1, resolution: "  " }).success, false);
  assert.equal(maintenanceTransitionSchema.safeParse({ status: "IN_PROGRESS", revision: 1 }).success, true);
});
test("Un mantenimiento cerrado no puede reabrirse ni resolverse dos veces", () => {
  assert.throws(() => assertMaintenanceTransition("RESOLVED", "IN_PROGRESS"));
  assert.throws(() => assertMaintenanceTransition("CANCELLED", "RESOLVED"));
  assert.doesNotThrow(() => assertMaintenanceTransition("OPEN", "IN_PROGRESS"));
});
test("Los documentos publicados no pueden volver a borrador", () => {
  assert.throws(() => assertDocumentTransition("PUBLISHED", "DRAFT"));
  assert.throws(() => assertDocumentTransition("PUBLISHED", "PUBLISHED"));
  assert.throws(() => assertDocumentTransition("ARCHIVED", "PUBLISHED"));
  assert.doesNotThrow(() => assertDocumentTransition("DRAFT", "PUBLISHED"));
});
const document = { kind: "PROTOCOL", title: "Protocolo", category: "Operativo", body: "Contenido operativo completo" };
test("Los protocolos rechazan referencias de actas y enlaces peligrosos", () => {
  assert.equal(createDocumentSchema.safeParse({ ...document, shiftId: "shift" }).success, false);
  for (const externalUrl of ["javascript:alert(1)", "http://example.org/doc", "https://user:password@example.org"]) {
    assert.equal(createDocumentSchema.safeParse({ ...document, externalUrl }).success, false);
  }
  assert.equal(createDocumentSchema.safeParse({ ...document, externalUrl: "https://example.org/doc.pdf" }).success, true);
});
test("Cada acta exige la referencia de su tipo y no acepta vinculos cruzados", () => {
  assert.equal(createDocumentSchema.safeParse({ ...document, kind: "SHIFT_REPORT" }).success, false);
  assert.equal(createDocumentSchema.safeParse({ ...document, kind: "SHIFT_REPORT", shiftId: "shift" }).success, true);
  assert.equal(createDocumentSchema.safeParse({ ...document, kind: "INCIDENT_REPORT", shiftId: "shift" }).success, false);
  assert.equal(createDocumentSchema.safeParse({ ...document, kind: "INCIDENT_REPORT", incidentId: "incident" }).success, true);
});
test("Una transaccion en conflicto se reintenta con aislamiento serializable", async (context) => {
  const original = prisma.$transaction;
  let attempts = 0;
  (prisma as any).$transaction = async (_work: unknown, options: any) => {
    assert.equal(options.isolationLevel, "Serializable");
    if (++attempts < 3) throw new Prisma.PrismaClientKnownRequestError("conflict", { code: "P2034", clientVersion: "test" });
    return "ok";
  };
  context.after(() => { prisma.$transaction = original; });
  assert.equal(await serializable(async () => "unused"), "ok");
  assert.equal(attempts, 3);
});
