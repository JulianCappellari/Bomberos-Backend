"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.measuredMinutes = measuredMinutes;
exports.meanSample = meanSample;
exports.operationalReport = operationalReport;
const prisma_1 = require("../../config/prisma");
const reports_service_1 = require("./reports.service");
function measuredMinutes(start, end) {
    return start && end && +end >= +start ? (+end - +start) / 60000 : null;
}
function meanSample(values) {
    const valid = values.filter((value) => value !== null && Number.isFinite(value));
    return { minutes: valid.length ? Math.round(valid.reduce((sum, value) => sum + value, 0) / valid.length * 10) / 10 : null, samples: valid.length, missing: values.length - valid.length };
}
async function operationalReport(month) {
    const { start, end } = (0, reports_service_1.reportBounds)(month), now = new Date();
    const [incidents, movements] = await prisma_1.prisma.$transaction([
        prisma_1.prisma.incident.findMany({ where: { occurredAt: { gte: start, lt: end } }, select: { type: true, createdAt: true, alert: { select: { createdAt: true, originNotice: { select: { receivedAt: true } } } }, movements: { where: { OR: [{ departure: null }, { departure: { voidedAt: null } }] }, orderBy: { departedAt: "asc" }, select: { departedAt: true, arrivedAt: true } } } }),
        prisma_1.prisma.missionMovement.findMany({ where: { departedAt: { lt: end }, OR: [{ returnedAt: { gt: start } }, { returnedAt: null }] }, select: { assetId: true, departedAt: true, returnedAt: true, arrivedAt: true, asset: { select: { name: true } }, departure: { select: { voidedAt: true } } } }),
    ], { isolationLevel: "RepeatableRead" });
    const byType = new Map(), vehicles = new Map();
    for (const row of incidents)
        byType.set(row.type, (byType.get(row.type) || 0) + 1);
    for (const row of movements) {
        if (row.departure?.voidedAt)
            continue;
        const vehicle = vehicles.get(row.assetId) || { assetId: row.assetId, name: row.asset.name, intervals: [], completed: 0, open: 0, withoutArrival: 0 };
        if (row.returnedAt && row.departure) {
            const left = Math.max(+start, +row.departedAt), right = Math.min(+end, +row.returnedAt, +now);
            if (right > left) {
                vehicle.intervals.push({ start: left, end: right });
                vehicle.completed++;
                if (!row.arrivedAt)
                    vehicle.withoutArrival++;
            }
        }
        else if (!row.returnedAt && +row.departedAt <= +now)
            vehicle.open++;
        vehicles.set(row.assetId, vehicle);
    }
    return { month, generatedAt: now, incidents: incidents.length, byType: [...byType].map(([type, count]) => ({ type, count })),
        noticeToDeparture: meanSample(incidents.map(row => measuredMinutes(row.alert?.originNotice?.receivedAt || row.alert?.createdAt, row.movements[0]?.departedAt))),
        noticeToOpening: meanSample(incidents.map(row => measuredMinutes(row.alert?.originNotice?.receivedAt || row.alert?.createdAt, row.createdAt))),
        openingToDeparture: meanSample(incidents.map(row => measuredMinutes(row.createdAt, row.movements[0]?.departedAt))),
        departureToArrival: meanSample(movements.filter(row => !row.departure?.voidedAt).map(row => measuredMinutes(row.departedAt, row.arrivedAt))),
        vehicles: [...vehicles.values()].map(({ intervals, ...row }) => ({ ...row, minutes: Math.floor((0, reports_service_1.unionMilliseconds)(intervals) / 60000) })).sort((a, b) => b.minutes - a.minutes),
    };
}
