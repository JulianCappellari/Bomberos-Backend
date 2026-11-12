import { z } from "zod";
import { prisma } from "../../config/prisma";
import { PUBLIC_USER_SELECT } from "../../utils/public-user";
export function canReadAllPersonnelStats(role: string) { return role === "ADMIN"; }

export const monthlyReportQuerySchema = z.object({
  month: z.string().regex(/^(20\d{2})-(0[1-9]|1[0-2])$/, "Seleccione un mes valido"),
});
export const fuelReportQuerySchema = z.object({
  period: z.enum(["THIS_MONTH", "LAST_MONTH", "THIS_YEAR", "LAST_YEAR", "ROLLING_YEAR", "ALL"]),
  assetId: z.string().cuid().optional(),
});

export async function fuelReport(query: z.infer<typeof fuelReportQuerySchema>) {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const start = query.period === "ALL" ? undefined
    : query.period === "THIS_MONTH" ? new Date(Date.UTC(year, month, 1, 3))
    : query.period === "LAST_MONTH" ? new Date(Date.UTC(year, month - 1, 1, 3))
    : query.period === "LAST_YEAR" ? new Date(Date.UTC(year - 1, 0, 1, 3))
    : query.period === "ROLLING_YEAR" ? new Date(Date.UTC(year, month - 11, 1, 3))
    : new Date(Date.UTC(year, 0, 1, 3));
  const end = query.period === "LAST_MONTH" ? new Date(Date.UTC(year, month, 1, 3))
    : query.period === "LAST_YEAR" ? new Date(Date.UTC(year, 0, 1, 3)) : now;
  const records = await prisma.fuelRecord.findMany({
    where: { voidedAt: null, ...(query.assetId ? { assetId: query.assetId } : {}), occurredAt: { ...(start ? { gte: start } : {}), lte: end } },
    select: { assetId: true, occurredAt: true, volumeMilliliters: true, costCents: true, odometer: true, asset: { select: { name: true } } },
    orderBy: [{ assetId: "asc" }, { occurredAt: "asc" }],
  });
  const vehicles = new Map<string, { assetId: string; name: string; milliliters: number; costCents: number; pricedLoads: number; loads: number; distanceKm: number; odometerReadings: number; lastOdometer: number | null }>();
  for (const record of records) {
    const row = vehicles.get(record.assetId) || { assetId: record.assetId, name: record.asset.name, milliliters: 0, costCents: 0, pricedLoads: 0, loads: 0, distanceKm: 0, odometerReadings: 0, lastOdometer: null };
    row.milliliters += record.volumeMilliliters;
    row.loads++;
    if (record.costCents !== null) { row.costCents += record.costCents; row.pricedLoads++; }
    if (record.odometer !== null) {
      if (row.lastOdometer !== null && record.odometer >= row.lastOdometer) row.distanceKm += record.odometer - row.lastOdometer;
      row.lastOdometer = record.odometer;
      row.odometerReadings++;
    }
    vehicles.set(record.assetId, row);
  }
  return {
    period: query.period, generatedAt: now,
    totals: { liters: records.reduce((sum, row) => sum + row.volumeMilliliters, 0) / 1000, loads: records.length,
      cost: records.reduce((sum, row) => sum + (row.costCents || 0), 0) / 100,
      pricedLoads: records.filter((row) => row.costCents !== null).length },
    vehicles: [...vehicles.values()].map(({ lastOdometer: _last, ...row }) => ({ ...row, liters: row.milliliters / 1000, cost: row.costCents / 100 }))
      .sort((a, b) => b.milliliters - a.milliliters),
  };
}
export function reportBounds(month: string) {
  const [year, number] = month.split("-").map(Number);
  return {
    start: new Date(Date.UTC(year, number - 1, 1, 3)),
    end: new Date(Date.UTC(year, number, 1, 3)),
    dateStart: new Date(Date.UTC(year, number - 1, 1)),
    dateEnd: new Date(Date.UTC(year, number, 1)),
  };
}
export function sessionMilliseconds(
  checkIn: Date,
  checkOut: Date,
  start: Date,
  end: Date,
) {
  if (checkOut < checkIn) return 0;
  return Math.max(0, Math.min(checkOut.getTime(), end.getTime()) - Math.max(checkIn.getTime(), start.getTime()));
}
export function unionMilliseconds(intervals: Array<{ start: number; end: number }>) {
  const ordered = [...intervals].sort((a, b) => a.start - b.start);
  let total = 0;
  let end = -Infinity;
  for (const interval of ordered) {
    total += Math.max(0, interval.end - Math.max(interval.start, end));
    end = Math.max(end, interval.end);
  }
  return total;
}
export const yearReportQuerySchema = z.object({ year: z.coerce.number().int().min(2020).max(2100) });
export async function yearHoursReport(year: number, actor: { userId: string; role: string }) {
  const start = new Date(Date.UTC(year, 0, 1, 3));
  const end = new Date(Date.UTC(year + 1, 0, 1, 3));
  const now = new Date();
  const attendances = await prisma.attendance.findMany({
    where: { ...(!canReadAllPersonnelStats(actor.role) ? { userId: actor.userId } : {}), checkInAt: { not: null, lt: end }, discardedAt: null, OR: [{ checkOutAt: { gt: start } }, { status: "OPEN" }] },
    select: { userId: true, checkInAt: true, checkOutAt: true, status: true, checkInTrust: true, checkOutTrust: true },
  });
  const months = Array.from({ length: 12 }, (_, index) => {
    const left = new Date(Date.UTC(year, index, 1, 3)).getTime();
    const right = new Date(Date.UTC(year, index + 1, 1, 3)).getTime();
    const byUser = new Map<string, Array<{ start: number; end: number }>>();
    for (const row of attendances) {
      if (!row.checkInAt || row.checkInTrust === "REJECTED" || row.checkOutTrust === "REJECTED") continue;
      const finish = row.checkOutAt || (row.status === "OPEN" ? now : null);
      if (!finish || finish < row.checkInAt) continue;
      const from = Math.max(left, row.checkInAt.getTime());
      const to = Math.min(right, finish.getTime(), now.getTime());
      if (to <= from) continue;
      const intervals = byUser.get(row.userId) || [];
      intervals.push({ start: from, end: to });
      byUser.set(row.userId, intervals);
    }
    return { month: index + 1, minutes: Math.floor([...byUser.values()].reduce((sum, intervals) => sum + unionMilliseconds(intervals), 0) / 60000), people: byUser.size };
  });
  return { year, scope: canReadAllPersonnelStats(actor.role) ? "ALL" : "SELF", generatedAt: now, months, totalMinutes: months.reduce((sum, row) => sum + row.minutes, 0), people: new Set(attendances.filter((row) => row.checkInTrust !== "REJECTED" && row.checkOutTrust !== "REJECTED").map((row) => row.userId)).size };
}
export async function monthlyReport(month: string, actor: { userId: string; role: string }) {
  const bounds = reportBounds(month);
  const manager = canReadAllPersonnelStats(actor.role);
  const now = new Date();
  const [attendances, alerts, incidents, inspections, shifts] = await Promise.all([
    prisma.attendance.findMany({
      where: {
        ...(!manager ? { userId: actor.userId } : {}),
        checkInAt: { not: null, lt: bounds.end }, discardedAt: null,
        OR: [{ checkOutAt: { gt: bounds.start } }, { status: "OPEN" }],
      },
      select: {
        userId: true, checkInAt: true, checkOutAt: true, status: true,
        checkInTrust: true, checkOutTrust: true, checkOutMethod: true,
        user: { select: PUBLIC_USER_SELECT },
      },
    }),
    prisma.alert.groupBy({
      by: ["type"], where: { createdAt: { gte: bounds.start, lt: bounds.end } }, _count: { _all: true },
    }),
    prisma.incident.count({ where: { occurredAt: { gte: bounds.start, lt: bounds.end } } }),
    prisma.inspection.count({ where: { inspectionDate: { gte: bounds.dateStart, lt: bounds.dateEnd } } }),
    prisma.shift.count({ where: { date: { gte: bounds.dateStart, lt: bounds.dateEnd } } }),
  ]);
  const people = new Map<string, { user: (typeof attendances)[number]["user"]; intervals: Array<{ start: number; end: number }>; sessions: number; openSessions: number; remoteCloses: number }>();
  let excludedSessions = 0;
  for (const attendance of attendances) {
    if (!attendance.checkInAt || attendance.checkInTrust === "REJECTED" || attendance.checkOutTrust === "REJECTED") {
      excludedSessions++; continue;
    }
    const end = attendance.checkOutAt || (attendance.status === "OPEN" ? now : null);
    if (!end || end < attendance.checkInAt) { excludedSessions++; continue; }
    const duration = sessionMilliseconds(attendance.checkInAt, end, bounds.start, bounds.end);
    if (!duration) continue;
    const row = people.get(attendance.userId) || { user: attendance.user, intervals: [], sessions: 0, openSessions: 0, remoteCloses: 0 };
    // Cierres sin QR: se acredito solo hasta la ultima presencia verificada; jefatura los ve en el reporte.
    if (attendance.checkOutMethod === "REMOTE" || attendance.checkOutMethod === "REMOTE_GPS") row.remoteCloses++;
    row.intervals.push({ start: Math.max(attendance.checkInAt.getTime(), bounds.start.getTime()), end: Math.min(end.getTime(), bounds.end.getTime()) });
    row.sessions++;
    if (attendance.status === "OPEN") row.openSessions++;
    people.set(attendance.userId, row);
  }
  const rows = [...people.values()].map((row) => ({
    user: row.user, workedMinutes: Math.floor(unionMilliseconds(row.intervals) / 60000),
    sessions: row.sessions, openSessions: row.openSessions, remoteCloses: row.remoteCloses,
  })).sort((a, b) => b.workedMinutes - a.workedMinutes || a.user.username.localeCompare(b.user.username));
  return {
    month, scope: manager ? "ALL" : "SELF", generatedAt: now,
    totals: {
      workedMinutes: rows.reduce((total, row) => total + row.workedMinutes, 0),
      sessions: rows.reduce((total, row) => total + row.sessions, 0),
      people: rows.length, openSessions: rows.reduce((total, row) => total + row.openSessions, 0), remoteCloses: rows.reduce((total, row) => total + row.remoteCloses, 0),
      alerts: alerts.reduce((total, group) => total + group._count._all, 0), incidents, inspections, shifts, excludedSessions,
    },
    alertsByType: alerts.map((group) => ({ type: group.type, count: group._count._all })),
    people: rows,
  };
}
