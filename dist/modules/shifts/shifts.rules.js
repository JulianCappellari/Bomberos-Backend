"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.shiftInterval = shiftInterval;
exports.shiftsOverlap = shiftsOverlap;
function shiftInterval(date, startTime, endTime) {
    const start = new Date(`${date}T${startTime}:00-03:00`).getTime();
    let end = new Date(`${date}T${endTime}:00-03:00`).getTime();
    if (end <= start)
        end += 86400000;
    return { start, end };
}
function shiftsOverlap(a, b) {
    const first = shiftInterval(a.date, a.startTime, a.endTime);
    const second = shiftInterval(b.date, b.startTime, b.endTime);
    return first.start < second.end && second.start < first.end;
}
