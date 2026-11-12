import { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma";
import { stationDate } from "../../utils/station-time";
import { shiftInterval } from "./shifts.rules";

type Db = Prisma.TransactionClient | typeof prisma;

/** Quienes estan cubriendo una guardia en este momento (por la grilla de guardias), con el turno. */
export async function onGuardNow(db: Db, userIds?: string[], now = new Date()) {
  const today = stationDate(now), yesterday = stationDate(new Date(+now - 86_400_000));
  const shifts = await db.shift.findMany({
    where: { date: { in: [new Date(yesterday), new Date(today)] }, ...(userIds ? { assignments: { some: { userId: { in: userIds } } } } : {}) },
    select: { date: true, startTime: true, endTime: true, period: true, shiftType: true, assignments: { select: { userId: true } } },
  });
  const result = new Map<string, { label: string; until: Date }>();
  for (const s of shifts) {
    const start = s.period === "DAY" ? "08:00" : s.period === "NIGHT" ? "20:00" : s.startTime;
    const end = s.period === "DAY" ? "20:00" : s.period === "NIGHT" ? "08:00" : s.endTime;
    const { start: from, end: to } = shiftInterval(s.date.toISOString().slice(0, 10), start, end);
    if (+now < from || +now >= to) continue;
    const label = s.period === "DAY" ? "Guardia diurna" : s.period === "NIGHT" ? "Guardia nocturna" : s.shiftType;
    for (const a of s.assignments) result.set(a.userId, { label, until: new Date(to) });
  }
  return result;
}
