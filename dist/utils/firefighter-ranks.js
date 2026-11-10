"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FIREFIGHTER_RANKS = void 0;
exports.normalizeRank = normalizeRank;
exports.isAllowedFirefighterRank = isAllowedFirefighterRank;
exports.isCommandRank = isCommandRank;
exports.effectiveAccessRole = effectiveAccessRole;
exports.guardFunctionAllowed = guardFunctionAllowed;
exports.FIREFIGHTER_RANKS = [
    "Oficial",
    "Sub oficial",
    "Bombero",
    "Aspirante",
    "Comision directiva",
    "Aspirante mayor",
    "Aspirante menor",
    "Administrador",
    "Guardia",
];
function normalizeRank(value) {
    return (value ?? "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[-_]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}
function isAllowedFirefighterRank(value) {
    const normalized = normalizeRank(value);
    return exports.FIREFIGHTER_RANKS.some((rank) => normalizeRank(rank) === normalized);
}
function isCommandRank(value) {
    const normalized = normalizeRank(value).replace(/\s/g, "");
    return normalized === "oficial" || normalized === "suboficial" || normalized === "administrador";
}
function effectiveAccessRole(role, rank) {
    if (role === "ADMIN" || normalizeRank(rank) === "oficial" || normalizeRank(rank) === "administrador")
        return "ADMIN";
    if (normalizeRank(rank).replace(/\s/g, "") === "suboficial")
        return "OPERATOR";
    if (normalizeRank(rank) === "guardia")
        return "GUARD";
    return role;
}
function guardFunctionAllowed(enabled, rank) {
    return enabled && ["bombero", "oficial", "suboficial"].includes(normalizeRank(rank).replace(/\s/g, ""));
}
