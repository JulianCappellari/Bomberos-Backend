"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.defaults = exports.policySchema = void 0;
exports.creditedControls = creditedControls;
exports.unionLength = unionLength;
exports.unpaidMinutes = unpaidMinutes;
exports.overdue = overdue;
const zod_1 = require("zod");
exports.policySchema = zod_1.z.object({ hour: zod_1.z.number().int().min(0).max(100), task: zod_1.z.number().int().min(0).max(1000), inspection: zod_1.z.number().int().min(0).max(1000), incident: zod_1.z.number().int().min(0).max(1000), course: zod_1.z.number().int().min(0).max(1000), missedTask: zod_1.z.number().int().min(0).max(1000), declinedTask: zod_1.z.number().int().min(0).max(1000).default(3), lowThreshold: zod_1.z.number().int().min(-10000).max(10000), recoveryDays: zod_1.z.number().int().min(1).max(30) }).strict();
exports.defaults = { hour: 2, task: 10, inspection: 8, incident: 15, course: 10, missedTask: 5, declinedTask: 3, lowThreshold: 20, recoveryDays: 7 };
function creditedControls(rows, month) {
    const first = new Map();
    for (const row of rows) { // L07: varios controles del mismo movil suman solo si se hicieron en dias distintos.
        const key = row.vehicleId + ":" + row.inspectionDate.toISOString().slice(0, 10);
        const old = first.get(key);
        if (!old || row.inspectionDate < old)
            first.set(key, row.inspectionDate);
    }
    return [...first.values()].filter(date => date.toISOString().startsWith(month)).length;
}
function unionLength(intervals) { let end = -Infinity, total = 0; for (const r of intervals.filter(r => r.end > r.start).sort((a, b) => a.start - b.start)) {
    total += Math.max(0, r.end - Math.max(r.start, end));
    end = Math.max(end, r.end);
} return total; }
function unpaidMinutes(presence, excluded) {
    const covered = presence.flatMap(p => excluded.map(x => ({ start: Math.max(p.start, x.start), end: Math.min(p.end, x.end) })));
    return Math.floor(Math.max(0, unionLength([...presence]) - unionLength(covered)) / 60000);
}
function overdue(task, today) {
    if (!task.dueOn || task.status === "CANCELLED")
        return false;
    const deadline = new Date(task.dueOn.toISOString().slice(0, 10) + "T23:59:59.999-03:00");
    if (deadline < task.createdAt)
        return false;
    if (task.status === "VERIFIED")
        return Boolean(task.completedAt && task.completedAt > deadline);
    return ["ASSIGNED", "RETURNED"].includes(task.status) && task.dueOn.toISOString().slice(0, 10) < today;
}
