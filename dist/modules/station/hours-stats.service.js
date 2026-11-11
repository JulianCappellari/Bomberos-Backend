"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.hoursStatistics = hoursStatistics;
const prisma_1 = require("../../config/prisma");
const reports_service_1 = require("../operations/reports.service");
const shifts_rules_1 = require("../shifts/shifts.rules");
const OFFSET = 3 * 3600000; // Argentina, UTC-3 sin horario de verano
const HOUR = 3600000;
function union(intervals) {
    const sorted = [...intervals].sort((a, b) => a.start - b.start), out = [];
    for (const i of sorted) {
        const last = out[out.length - 1];
        if (last && i.start <= last.end)
            last.end = Math.max(last.end, i.end);
        else
            out.push({ ...i });
    }
    return out;
}
function intersect(a, b) {
    const out = [];
    for (const x of a)
        for (const y of b) {
            const s = Math.max(x.start, y.start), e = Math.min(x.end, y.end);
            if (e > s)
                out.push({ start: s, end: e });
        }
    return union(out);
}
function subtract(a, b) {
    let rest = a.map((i) => ({ ...i }));
    for (const y of b)
        rest = rest.flatMap((x) => {
            if (y.end <= x.start || y.start >= x.end)
                return [x];
            const parts = [];
            if (y.start > x.start)
                parts.push({ start: x.start, end: y.start });
            if (y.end < x.end)
                parts.push({ start: y.end, end: x.end });
            return parts;
        });
    return rest;
}
async function hoursStatistics(actor, input) {
    const all = (0, reports_service_1.canReadAllPersonnelStats)(actor.role);
    const now = Date.now();
    const startMonth = input.scope === "month" ? (input.month ?? 1) - 1 : 0;
    const from = Date.UTC(input.year, startMonth, 1) + OFFSET;
    const to = Math.min(input.scope === "month" ? Date.UTC(input.year, startMonth + 1, 1) + OFFSET : Date.UTC(input.year + 1, 0, 1) + OFFSET, now);
    const empty = { scope: input.scope, kind: input.kind, year: input.year, month: input.month ?? null, audience: all ? "ALL" : "SELF", totalMinutes: 0, people: 0, averageMinutes: 0, averageUnit: input.scope === "year" ? "month" : "day", buckets: [], weekdays: Array(7).fill(0), blocks: [0, 0, 0, 0], top: [] };
    if (to <= from)
        return empty;
    const [attendances, shifts] = await Promise.all([
        prisma_1.prisma.attendance.findMany({
            where: { ...(all ? {} : { userId: actor.userId }), checkInAt: { not: null, lt: new Date(to) }, discardedAt: null, checkInQrId: { not: null }, OR: [{ checkOutAt: { gt: new Date(from) } }, { status: "OPEN" }] },
            select: { userId: true, checkInAt: true, checkOutAt: true, status: true, checkInTrust: true, checkOutTrust: true },
        }),
        prisma_1.prisma.shift.findMany({
            where: { date: { gte: new Date(from - 2 * 86400000), lt: new Date(to + 86400000) }, ...(all ? {} : { assignments: { some: { userId: actor.userId } } }) },
            select: { date: true, startTime: true, endTime: true, assignments: { select: { userId: true } } },
        }),
    ]);
    const presence = new Map();
    for (const row of attendances) {
        if (!row.checkInAt || row.checkInTrust === "REJECTED" || row.checkOutTrust === "REJECTED")
            continue;
        const finish = row.checkOutAt?.getTime() ?? (row.status === "OPEN" ? now : null);
        if (!finish)
            continue;
        const s = Math.max(from, row.checkInAt.getTime()), e = Math.min(to, finish);
        if (e > s)
            presence.set(row.userId, [...(presence.get(row.userId) ?? []), { start: s, end: e }]);
    }
    const guard = new Map();
    for (const shift of shifts) {
        const { start, end } = (0, shifts_rules_1.shiftInterval)(shift.date.toISOString().slice(0, 10), shift.startTime, shift.endTime);
        for (const a of shift.assignments)
            guard.set(a.userId, [...(guard.get(a.userId) ?? []), { start, end }]);
    }
    const bucketCount = input.scope === "year" ? 12 : new Date(Date.UTC(input.year, startMonth + 1, 0)).getUTCDate();
    const buckets = Array(bucketCount).fill(0), weekdays = Array(7).fill(0), blocks = [0, 0, 0, 0];
    const perUser = new Map();
    for (const [userId, raw] of presence) {
        const merged = union(raw), turns = union(guard.get(userId) ?? []);
        const counted = input.kind === "guard" ? intersect(merged, turns) : subtract(merged, turns);
        for (const iv of counted) {
            // Se reparte por tramos de hora local para ubicar cada minuto en su mes/dia, dia de la semana y franja.
            let t = iv.start;
            while (t < iv.end) {
                const local = new Date(t - OFFSET);
                const next = Math.min(iv.end, Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), local.getUTCHours() + 1) + OFFSET);
                const minutes = (next - t) / 60000;
                buckets[input.scope === "year" ? local.getUTCMonth() : local.getUTCDate() - 1] += minutes;
                weekdays[(local.getUTCDay() + 6) % 7] += minutes; // lunes primero
                const h = local.getUTCHours();
                blocks[h < 6 ? 3 : h < 12 ? 0 : h < 18 ? 1 : 2] += minutes;
                perUser.set(userId, (perUser.get(userId) ?? 0) + minutes);
                t = next;
            }
        }
    }
    const total = [...perUser.values()].reduce((a, b) => a + b, 0);
    const elapsedUnits = input.scope === "year"
        ? (input.year === new Date(now - OFFSET).getUTCFullYear() ? new Date(now - OFFSET).getUTCMonth() + 1 : 12)
        : Math.max(1, Math.ceil((to - from) / 86400000));
    const people = [...perUser.values()].filter((m) => m >= 1).length;
    let top = [];
    if (all && perUser.size) {
        const ids = [...perUser.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
        const users = await prisma_1.prisma.user.findMany({ where: { id: { in: ids.map(([id]) => id) } }, select: { id: true, username: true, profile: { select: { fullName: true } } } });
        top = ids.map(([id, m]) => ({ userId: id, name: users.find((u) => u.id === id)?.profile?.fullName || users.find((u) => u.id === id)?.username || "Integrante", minutes: Math.round(m) })).filter((r) => r.minutes > 0);
    }
    const monthLabels = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
    return {
        ...empty,
        totalMinutes: Math.round(total), people, averageMinutes: Math.round(total / elapsedUnits),
        buckets: buckets.map((m, i) => ({ label: input.scope === "year" ? monthLabels[i] : String(i + 1), minutes: Math.round(m) })),
        weekdays: weekdays.map(Math.round), blocks: blocks.map(Math.round), top,
    };
}
