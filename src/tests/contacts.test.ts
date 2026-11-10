import assert from "node:assert/strict";
import { test } from "node:test";
import { createContactSchema, updateContactSchema, deleteContactSchema } from "../modules/contacts/contacts.schemas";
import { updateContact } from "../modules/contacts/contacts.service";
import { prisma } from "../config/prisma";

test("Contactos requieren un canal de comunicacion", () => {
  assert.equal(createContactSchema.safeParse({ name: "Central", category: "Apoyo" }).success, false);
  assert.equal(createContactSchema.safeParse({ name: "Central", category: "Apoyo", phone: "100" }).success, true);
  assert.equal(createContactSchema.safeParse({ name: "Central", category: "Apoyo", radioFrequency: "Canal 3" }).success, true);
  assert.equal(createContactSchema.safeParse({ name: "Central", category: "Apoyo", email: "central@example.org" }).success, true);
});

test("No acepta enlaces como telefono ni correos invalidos", () => {
  assert.equal(createContactSchema.safeParse({ name: "Central", category: "Apoyo", phone: "javascript:alert(1)" }).success, false);
  assert.equal(createContactSchema.safeParse({ name: "Central", category: "Apoyo", email: "no-es-correo" }).success, false);
});

test("Editar y borrar requieren la revision leida", () => {
  assert.equal(updateContactSchema.safeParse({ name: "Central", category: "Apoyo", phone: "100" }).success, false);
  assert.equal(deleteContactSchema.safeParse({}).success, false);
  assert.equal(deleteContactSchema.safeParse({ revision: "2" }).success, true);
});

test("Una edicion obsoleta devuelve conflicto sin generar auditoria", async (context) => {
  const original = prisma.$transaction;
  let audits = 0;
  (prisma as any).$transaction = async (callback: any) => callback({
    operationalContact: { updateMany: async () => ({ count: 0 }) },
    auditLog: { create: async () => { audits++; } },
  });
  context.after(() => { prisma.$transaction = original; });
  await assert.rejects(
    updateContact("contact", { name: "Central", category: "Apoyo", phone: "100", revision: 1, isEmergency: false }, "actor"),
    (err: unknown) => err instanceof Error && "status" in err && err.status === 409,
  );
  assert.equal(audits, 0);
});

test("La actualizacion valida incrementa revision y audita en la transaccion", async (context) => {
  const original = prisma.$transaction;
  const audits: any[] = [];
  let updateQuery: any;
  (prisma as any).$transaction = async (callback: any) => callback({
    operationalContact: {
      updateMany: async (query: any) => { updateQuery = query; return { count: 1 }; },
      findUniqueOrThrow: async () => ({ id: "contact", revision: 2 }),
    },
    auditLog: { create: async (query: any) => { audits.push(query.data); } },
  });
  context.after(() => { prisma.$transaction = original; });
  const result = await updateContact("contact", {
    name: "Central", category: "Apoyo", phone: "100", revision: 1, isEmergency: true,
  }, "actor");
  assert.equal(result.revision, 2);
  assert.equal(updateQuery.where.revision, 1);
  assert.deepEqual(updateQuery.data.revision, { increment: 1 });
  assert.equal(audits[0].action, "CONTACT_UPDATED");
});
