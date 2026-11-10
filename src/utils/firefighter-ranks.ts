export const FIREFIGHTER_RANKS = [
  "Oficial",
  "Sub oficial",
  "Bombero",
  "Aspirante",
  "Comision directiva",
  "Aspirante mayor",
  "Aspirante menor",
  "Administrador",
  "Guardia",
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
  return normalized === "oficial" || normalized === "suboficial" || normalized === "administrador";
}

export function effectiveAccessRole(role: string, rank?: string | null) {
  if (role === "ADMIN" || normalizeRank(rank) === "oficial" || normalizeRank(rank) === "administrador") return "ADMIN";
  if (normalizeRank(rank).replace(/\s/g, "") === "suboficial") return "OPERATOR";
  if (normalizeRank(rank) === "guardia") return "GUARD";
  return role;
}
export function guardFunctionAllowed(enabled: boolean, rank?: string | null) {
  return enabled && ["bombero","oficial","suboficial"].includes(normalizeRank(rank).replace(/\s/g,""));
}
