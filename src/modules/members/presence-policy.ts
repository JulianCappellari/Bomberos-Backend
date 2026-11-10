// E13/M04: la excepcion de revalidacion rige desde el inicio hasta el fin del turno asignado.
// Cada turno es independiente: al terminar uno se revalida aunque exista otro consecutivo.
export function guardPresenceUntil(base: Date, intervals: Array<{ start: number; end: number }>) {
  const at = base.getTime();
  const current = intervals.filter(i => Number.isFinite(i.start) && i.end > i.start && i.start <= at && at < i.end).sort((a,b) => b.end-a.end)[0];
  return current ? new Date(current.end) : null;
}
