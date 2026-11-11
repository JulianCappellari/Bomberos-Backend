"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.gpsSuspicionReasons = gpsSuspicionReasons;
exports.recordGpsSuspicion = recordGpsSuspicion;
const notifications_service_1 = require("../modules/members/notifications.service");
// T09: senales tipicas de una ubicacion fabricada. No bloquean por si solas (un GPS real puede
// coincidir); marcan la sospecha, la auditan y la informan a jefatura para su revision.
function gpsSuspicionReasons(input, previous) {
    const reasons = [];
    if (typeof input.accuracy === "number" && input.accuracy < 1)
        reasons.push("Precisión informada inferior a 1 metro");
    const decimals = (value) => (String(value).split(".")[1] || "").length;
    if (decimals(input.latitude) <= 3 && decimals(input.longitude) <= 3)
        reasons.push("Coordenadas redondeadas");
    if (previous?.latitude === input.latitude && previous?.longitude === input.longitude)
        reasons.push("Coordenadas idénticas a la verificación anterior");
    return reasons;
}
async function recordGpsSuspicion(tx, userId, attendanceId, context, reasons) {
    if (!reasons.length)
        return;
    await tx.auditLog.create({ data: { actorUserId: userId, action: "PRESENCE_GPS_SUSPICIOUS", entityType: "Attendance", entityId: attendanceId, metadata: { context, reasons } } });
    await (0, notifications_service_1.notifyCommand)(tx, "Ubicación sospechosa en un registro de presencia", "/station", `${context}: ${reasons.join("; ")}`, userId);
}
