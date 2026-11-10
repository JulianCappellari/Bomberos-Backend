"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const client_1 = require("@prisma/client");
const operations_schemas_1 = require("../modules/operations/operations.schemas");
const availability_service_1 = require("../modules/operations/availability.service");
const transaction_1 = require("../utils/transaction");
const prisma_1 = require("../config/prisma");
(0, node_test_1.test)("Solo administradores y operadores gestionan operaciones", () => {
    strict_1.default.equal((0, operations_schemas_1.isOperationsManager)("ADMIN"), true);
    strict_1.default.equal((0, operations_schemas_1.isOperationsManager)("OPERATOR"), true);
    strict_1.default.equal((0, operations_schemas_1.isOperationsManager)("FIREFIGHTER"), false);
});
(0, node_test_1.test)("La disponibilidad requiere un turno y estado conocidos", () => {
    strict_1.default.equal(operations_schemas_1.availabilitySchema.safeParse({ date: "2099-01-01", period: "DAY", status: "AVAILABLE" }).success, true);
    strict_1.default.equal(operations_schemas_1.availabilitySchema.safeParse({ date: "2099-01-01", period: "OTHER", status: "AVAILABLE" }).success, false);
});
(0, node_test_1.test)("Un bombero no puede modificar disponibilidad ajena", async () => {
    await strict_1.default.rejects((0, availability_service_1.saveAvailability)({
        userId: "other", date: "2099-01-01", period: "DAY", status: "UNAVAILABLE", revision: 0,
    }, { userId: "self", role: "FIREFIGHTER" }), (error) => error.status === 403);
});
(0, node_test_1.test)("La disponibilidad historica queda en modo de solo lectura", async () => {
    await strict_1.default.rejects((0, availability_service_1.saveAvailability)({
        date: "2000-01-01", period: "DAY", status: "AVAILABLE", revision: 0,
    }, { userId: "self", role: "ADMIN" }), (error) => error.status === 400);
});
(0, node_test_1.test)("Los trabajos requieren descripcion y no admiten costos negativos", () => {
    strict_1.default.equal(operations_schemas_1.maintenanceSchema.safeParse({ assetId: "a", title: "Motor", description: "x" }).success, false);
    strict_1.default.equal(operations_schemas_1.maintenanceTransitionSchema.safeParse({ status: "RESOLVED", revision: 1, resolution: "Trabajo realizado", costCents: -1 }).success, false);
});
(0, node_test_1.test)("Cerrar o cancelar mantenimiento exige una resolucion", () => {
    strict_1.default.equal(operations_schemas_1.maintenanceTransitionSchema.safeParse({ status: "RESOLVED", revision: 1 }).success, false);
    strict_1.default.equal(operations_schemas_1.maintenanceTransitionSchema.safeParse({ status: "CANCELLED", revision: 1, resolution: "  " }).success, false);
    strict_1.default.equal(operations_schemas_1.maintenanceTransitionSchema.safeParse({ status: "IN_PROGRESS", revision: 1 }).success, true);
});
(0, node_test_1.test)("Un mantenimiento cerrado no puede reabrirse ni resolverse dos veces", () => {
    strict_1.default.throws(() => (0, operations_schemas_1.assertMaintenanceTransition)("RESOLVED", "IN_PROGRESS"));
    strict_1.default.throws(() => (0, operations_schemas_1.assertMaintenanceTransition)("CANCELLED", "RESOLVED"));
    strict_1.default.doesNotThrow(() => (0, operations_schemas_1.assertMaintenanceTransition)("OPEN", "IN_PROGRESS"));
});
(0, node_test_1.test)("Los documentos publicados no pueden volver a borrador", () => {
    strict_1.default.throws(() => (0, operations_schemas_1.assertDocumentTransition)("PUBLISHED", "DRAFT"));
    strict_1.default.throws(() => (0, operations_schemas_1.assertDocumentTransition)("PUBLISHED", "PUBLISHED"));
    strict_1.default.throws(() => (0, operations_schemas_1.assertDocumentTransition)("ARCHIVED", "PUBLISHED"));
    strict_1.default.doesNotThrow(() => (0, operations_schemas_1.assertDocumentTransition)("DRAFT", "PUBLISHED"));
});
const document = { kind: "PROTOCOL", title: "Protocolo", category: "Operativo", body: "Contenido operativo completo" };
(0, node_test_1.test)("Los protocolos rechazan referencias de actas y enlaces peligrosos", () => {
    strict_1.default.equal(operations_schemas_1.createDocumentSchema.safeParse({ ...document, shiftId: "shift" }).success, false);
    for (const externalUrl of ["javascript:alert(1)", "http://example.org/doc", "https://user:password@example.org"]) {
        strict_1.default.equal(operations_schemas_1.createDocumentSchema.safeParse({ ...document, externalUrl }).success, false);
    }
    strict_1.default.equal(operations_schemas_1.createDocumentSchema.safeParse({ ...document, externalUrl: "https://example.org/doc.pdf" }).success, true);
});
(0, node_test_1.test)("Cada acta exige la referencia de su tipo y no acepta vinculos cruzados", () => {
    strict_1.default.equal(operations_schemas_1.createDocumentSchema.safeParse({ ...document, kind: "SHIFT_REPORT" }).success, false);
    strict_1.default.equal(operations_schemas_1.createDocumentSchema.safeParse({ ...document, kind: "SHIFT_REPORT", shiftId: "shift" }).success, true);
    strict_1.default.equal(operations_schemas_1.createDocumentSchema.safeParse({ ...document, kind: "INCIDENT_REPORT", shiftId: "shift" }).success, false);
    strict_1.default.equal(operations_schemas_1.createDocumentSchema.safeParse({ ...document, kind: "INCIDENT_REPORT", incidentId: "incident" }).success, true);
});
(0, node_test_1.test)("Una transaccion en conflicto se reintenta con aislamiento serializable", async (context) => {
    const original = prisma_1.prisma.$transaction;
    let attempts = 0;
    prisma_1.prisma.$transaction = async (_work, options) => {
        strict_1.default.equal(options.isolationLevel, "Serializable");
        if (++attempts < 3)
            throw new client_1.Prisma.PrismaClientKnownRequestError("conflict", { code: "P2034", clientVersion: "test" });
        return "ok";
    };
    context.after(() => { prisma_1.prisma.$transaction = original; });
    strict_1.default.equal(await (0, transaction_1.serializable)(async () => "unused"), "ok");
    strict_1.default.equal(attempts, 3);
});
