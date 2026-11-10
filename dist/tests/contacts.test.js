"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const contacts_schemas_1 = require("../modules/contacts/contacts.schemas");
const contacts_service_1 = require("../modules/contacts/contacts.service");
const prisma_1 = require("../config/prisma");
(0, node_test_1.test)("Contactos requieren un canal de comunicacion", () => {
    strict_1.default.equal(contacts_schemas_1.createContactSchema.safeParse({ name: "Central", category: "Apoyo" }).success, false);
    strict_1.default.equal(contacts_schemas_1.createContactSchema.safeParse({ name: "Central", category: "Apoyo", phone: "100" }).success, true);
    strict_1.default.equal(contacts_schemas_1.createContactSchema.safeParse({ name: "Central", category: "Apoyo", radioFrequency: "Canal 3" }).success, true);
    strict_1.default.equal(contacts_schemas_1.createContactSchema.safeParse({ name: "Central", category: "Apoyo", email: "central@example.org" }).success, true);
});
(0, node_test_1.test)("No acepta enlaces como telefono ni correos invalidos", () => {
    strict_1.default.equal(contacts_schemas_1.createContactSchema.safeParse({ name: "Central", category: "Apoyo", phone: "javascript:alert(1)" }).success, false);
    strict_1.default.equal(contacts_schemas_1.createContactSchema.safeParse({ name: "Central", category: "Apoyo", email: "no-es-correo" }).success, false);
});
(0, node_test_1.test)("Editar y borrar requieren la revision leida", () => {
    strict_1.default.equal(contacts_schemas_1.updateContactSchema.safeParse({ name: "Central", category: "Apoyo", phone: "100" }).success, false);
    strict_1.default.equal(contacts_schemas_1.deleteContactSchema.safeParse({}).success, false);
    strict_1.default.equal(contacts_schemas_1.deleteContactSchema.safeParse({ revision: "2" }).success, true);
});
(0, node_test_1.test)("Una edicion obsoleta devuelve conflicto sin generar auditoria", async (context) => {
    const original = prisma_1.prisma.$transaction;
    let audits = 0;
    prisma_1.prisma.$transaction = async (callback) => callback({
        operationalContact: { updateMany: async () => ({ count: 0 }) },
        auditLog: { create: async () => { audits++; } },
    });
    context.after(() => { prisma_1.prisma.$transaction = original; });
    await strict_1.default.rejects((0, contacts_service_1.updateContact)("contact", { name: "Central", category: "Apoyo", phone: "100", revision: 1, isEmergency: false }, "actor"), (err) => err instanceof Error && "status" in err && err.status === 409);
    strict_1.default.equal(audits, 0);
});
(0, node_test_1.test)("La actualizacion valida incrementa revision y audita en la transaccion", async (context) => {
    const original = prisma_1.prisma.$transaction;
    const audits = [];
    let updateQuery;
    prisma_1.prisma.$transaction = async (callback) => callback({
        operationalContact: {
            updateMany: async (query) => { updateQuery = query; return { count: 1 }; },
            findUniqueOrThrow: async () => ({ id: "contact", revision: 2 }),
        },
        auditLog: { create: async (query) => { audits.push(query.data); } },
    });
    context.after(() => { prisma_1.prisma.$transaction = original; });
    const result = await (0, contacts_service_1.updateContact)("contact", {
        name: "Central", category: "Apoyo", phone: "100", revision: 1, isEmergency: true,
    }, "actor");
    strict_1.default.equal(result.revision, 2);
    strict_1.default.equal(updateQuery.where.revision, 1);
    strict_1.default.deepEqual(updateQuery.data.revision, { increment: 1 });
    strict_1.default.equal(audits[0].action, "CONTACT_UPDATED");
});
