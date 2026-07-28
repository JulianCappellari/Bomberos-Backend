"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FIREFIGHTER_RANKS = void 0;
exports.normalizeRank = normalizeRank;
exports.isAllowedFirefighterRank = isAllowedFirefighterRank;
exports.isCommandRank = isCommandRank;
exports.FIREFIGHTER_RANKS = [
    "Oficial",
    "Sub oficial",
    "Bombero",
    "Aspirante",
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
    return normalized === "oficial" || normalized === "suboficial";
}
