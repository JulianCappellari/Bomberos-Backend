export const FIREFIGHTER_RANKS = [
  "Oficial",
  "Sub oficial",
  "Bombero",
  "Aspirante",
] as const;

export type FirefighterRank = (typeof FIREFIGHTER_RANKS)[number];

export function normalizeRank(value?: string | null) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[-_]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isAllowedFirefighterRank(value?: string | null) {
  const normalized = normalizeRank(value);
  return FIREFIGHTER_RANKS.some((rank) => normalizeRank(rank) === normalized);
}

export function isCommandRank(value?: string | null) {
  const normalized = normalizeRank(value).replace(/\s/g, "");
  return normalized === "oficial" || normalized === "suboficial";
}
