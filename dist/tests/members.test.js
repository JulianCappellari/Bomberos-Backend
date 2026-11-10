"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const members_service_1 = require("../modules/members/members.service");
const members_schemas_1 = require("../modules/members/members.schemas");
const presence_service_1 = require("../modules/members/presence.service");
const firefighter_ranks_1 = require("../utils/firefighter-ranks");
const groups_service_1 = require("../modules/members/groups.service");
(0, node_test_1.test)("Perfil y prendas: titular y mando, no guardia ni otros usuarios", () => {
    const staff = { userId: "a", role: "FIREFIGHTER" }, sub = { userId: "b", role: "OPERATOR" }, admin = { userId: "c", role: "ADMIN" };
    (0, strict_1.default)((0, members_service_1.canReadPrivateProfile)(staff, "a"));
    (0, strict_1.default)(!(0, members_service_1.canReadPrivateProfile)(staff, "b"));
    (0, strict_1.default)((0, members_service_1.canReadPrivateProfile)(sub, "a"));
    (0, strict_1.default)(!(0, members_service_1.canReadDeclarations)(sub, "a", "CLOTHING"));
    (0, strict_1.default)((0, members_service_1.canReadDeclarations)(sub, "a", "DRIVER_LICENSE"));
    (0, strict_1.default)((0, members_service_1.canReadDeclarations)(admin, "a", "CLOTHING"));
    (0, strict_1.default)(!(0, members_service_1.canReadDeclarations)({ userId: "g", role: "GUARD" }, "a", "CLOTHING"));
});
(0, node_test_1.test)("El perfil personal no admite cambiar rol, cargo ni identidad", () => {
    const body = { phone: "", altPhone: "", address: "", bloodType: "", revision: new Date().toISOString(), emergencyContact: { fullName: "Contacto", phone: "555", relationship: "" } };
    (0, strict_1.default)(members_schemas_1.personalProfileSchema.safeParse(body).success);
    for (const extra of [{ role: "ADMIN" }, { rank: "Oficial" }, { userId: "otro" }])
        (0, strict_1.default)(!members_schemas_1.personalProfileSchema.safeParse({ ...body, ...extra }).success);
});
(0, node_test_1.test)("El cargo oficial obtiene administracion; suboficial obtiene operacion", () => {
    strict_1.default.equal((0, firefighter_ranks_1.effectiveAccessRole)("FIREFIGHTER", "Oficial"), "ADMIN");
    strict_1.default.equal((0, firefighter_ranks_1.effectiveAccessRole)("FIREFIGHTER", "Sub oficial"), "OPERATOR");
    for (const rank of ["Bombero", "Comision directiva", "Aspirante mayor", "Aspirante menor"])
        strict_1.default.equal((0, firefighter_ranks_1.effectiveAccessRole)("FIREFIGHTER", rank), "FIREFIGHTER");
});
(0, node_test_1.test)("La función adicional de guardia exige habilitación y un cargo operativo", () => {
    for (const rank of ["Bombero", "Oficial", "Sub oficial", "Sub-oficial"]) {
        (0, strict_1.default)((0, firefighter_ranks_1.guardFunctionAllowed)(true, rank));
        (0, strict_1.default)(!(0, firefighter_ranks_1.guardFunctionAllowed)(false, rank));
    }
    for (const rank of ["Administrador", "Aspirante menor", "Aspirante mayor", "Comision directiva", "Guardia"])
        (0, strict_1.default)(!(0, firefighter_ranks_1.guardFunctionAllowed)(true, rank));
});
(0, node_test_1.test)("Una edicion cambia la huella del mensaje y exige otro acuse", () => {
    const message = { id: "m", body: "Texto", createdAt: new Date("2026-01-01"), editedAt: null };
    strict_1.default.notEqual((0, members_service_1.messageFingerprint)(message), (0, members_service_1.messageFingerprint)({ ...message, body: "Editado" }));
    strict_1.default.notEqual((0, members_service_1.messageFingerprint)(message), (0, members_service_1.messageFingerprint)({ ...message, editedAt: new Date("2026-01-02") }));
});
(0, node_test_1.test)("Disponibilidad no admite periodos invertidos", () => {
    (0, strict_1.default)(!members_schemas_1.periodSchema.safeParse({ startsAt: "2026-01-02T00:00:00Z", endsAt: "2026-01-01T00:00:00Z" }).success);
});
(0, node_test_1.test)("Revalidacion vence a los treinta minutos y exige GPS reciente de 100m", () => {
    const now = new Date("2026-01-01T12:00:00Z");
    strict_1.default.equal((0, presence_service_1.presenceDueAt)({ checkInAt: now }).getTime() - now.getTime(), 1800000);
    const point = { latitude: -33, longitude: -64, accuracy: 10, capturedAt: now.toISOString() };
    strict_1.default.equal((0, presence_service_1.assertPresenceLocation)(point, { latitude: -33, longitude: -64 }, now), 0);
    strict_1.default.throws(() => (0, presence_service_1.assertPresenceLocation)({ ...point, latitude: -34 }, { latitude: -33, longitude: -64 }, now));
    strict_1.default.throws(() => (0, presence_service_1.assertPresenceLocation)({ ...point, accuracy: 60 }, { latitude: -33, longitude: -64 }, now));
    strict_1.default.throws(() => (0, presence_service_1.assertPresenceLocation)({ ...point, capturedAt: "2026-01-01T10:00:00Z" }, { latitude: -33, longitude: -64 }, now));
    (0, strict_1.default)(!presence_service_1.presenceSchema.safeParse({ inside: true, attendanceId: "a" }).success);
});
(0, node_test_1.test)("La rotacion conserva la semana vigente y calcula la siguiente", () => {
    const anchor = new Date("2026-01-05");
    strict_1.default.equal((0, groups_service_1.nextControlWeek)(anchor, 4, new Date("2026-01-07")).current, true);
    strict_1.default.equal((0, groups_service_1.nextControlWeek)(anchor, 4, new Date("2026-01-15")).start.toISOString().slice(0, 10), "2026-02-02");
    strict_1.default.equal((0, groups_service_1.nextControlWeek)(anchor, 4, new Date("2026-01-01")).start.getTime(), anchor.getTime());
});
