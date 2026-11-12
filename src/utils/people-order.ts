import { normalizeRank } from "./firefighter-ranks";

// Orden institucional de cualquier listado de personas:
// 1) cargo (Oficial primero ... Aspirante menor ultimo; despues los cargos civiles y de servicio),
// 2) antiguedad (fecha de ingreso mas antigua primero), 3) cursos aprobados (mas cursos primero), 4) nombre.
const RANK_ORDER = ["oficial", "sub oficial", "bombero", "aspirante mayor", "aspirante", "aspirante menor", "administrador", "comision directiva", "guardia"].map((r) => r.replace(/\s/g, ""));

export function rankPosition(rank?: string | null) {
  const index = RANK_ORDER.indexOf(normalizeRank(rank).replace(/\s/g, ""));
  return index === -1 ? RANK_ORDER.length : index;
}

export type Orderable = {
  username?: string | null;
  profile?: { fullName?: string | null; rank?: string | null; joinDate?: Date | string | null } | null;
  _count?: { courses?: number } | null;
};

export function comparePeople(a: Orderable, b: Orderable) {
  const rank = rankPosition(a.profile?.rank) - rankPosition(b.profile?.rank);
  if (rank) return rank;
  const joinA = a.profile?.joinDate ? +new Date(a.profile.joinDate) : Number.POSITIVE_INFINITY;
  const joinB = b.profile?.joinDate ? +new Date(b.profile.joinDate) : Number.POSITIVE_INFINITY;
  if (joinA !== joinB) return joinA < joinB ? -1 : 1;
  const courses = (b._count?.courses ?? 0) - (a._count?.courses ?? 0);
  if (courses) return courses;
  return (a.profile?.fullName || a.username || "").localeCompare(b.profile?.fullName || b.username || "", "es");
}

export function sortPeople<T extends Orderable>(rows: T[]) {
  return [...rows].sort(comparePeople);
}
/** Para listados donde la persona viene anidada (asistencias, dotaciones). */
export function sortByPerson<T>(rows: T[], person: (row: T) => Orderable | null | undefined) {
  return [...rows].sort((a, b) => comparePeople(person(a) ?? {}, person(b) ?? {}));
}
