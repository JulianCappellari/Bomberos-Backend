import { OperationError } from "../operations/operations.schemas";
export function fillWindow(startedAt: string, endedAt: string, now = new Date()) {
  const start = new Date(startedAt), end = new Date(endedAt);
  const runMinutes = Math.ceil((end.getTime() - start.getTime()) / 60000);
  if (!Number.isFinite(runMinutes) || runMinutes < 1 || runMinutes > 1440 || end > now) throw new OperationError(400, "El intervalo debe ser pasado, positivo y no superar 24 horas por registro");
  return { start, end, runMinutes };
}
export function filterRemaining(total: number, baseline: number, life: number) { return Math.max(0, life - (total - baseline)); }
export function hydroCurrent(test: { result: string; validUntil: Date | null } | undefined, today: string) {
  return !!test && test.result === "PASS" && !!test.validUntil && test.validUntil.toISOString().slice(0, 10) >= today;
}
