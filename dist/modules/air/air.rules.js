"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fillWindow = fillWindow;
exports.filterRemaining = filterRemaining;
exports.hydroCurrent = hydroCurrent;
const operations_schemas_1 = require("../operations/operations.schemas");
function fillWindow(startedAt, endedAt, now = new Date()) {
    const start = new Date(startedAt), end = new Date(endedAt);
    const runMinutes = Math.ceil((end.getTime() - start.getTime()) / 60000);
    if (!Number.isFinite(runMinutes) || runMinutes < 1 || runMinutes > 1440 || end > now)
        throw new operations_schemas_1.OperationError(400, "El intervalo debe ser pasado, positivo y no superar 24 horas por registro");
    return { start, end, runMinutes };
}
function filterRemaining(total, baseline, life) { return Math.max(0, life - (total - baseline)); }
function hydroCurrent(test, today) {
    return !!test && test.result === "PASS" && !!test.validUntil && test.validUntil.toISOString().slice(0, 10) >= today;
}
