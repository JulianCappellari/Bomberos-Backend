"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.personalStatistics = personalStatistics;
const prisma_1 = require("../../config/prisma");
const credited_services_1 = require("../incidents/credited-services");
const operations_schemas_1 = require("../operations/operations.schemas");
const reports_service_1 = require("../operations/reports.service");
async function personalStatistics(userId, actor) {
    if (actor.userId !== userId && actor.role !== "ADMIN")
        throw new operations_schemas_1.OperationError(403, "Solo puede consultar sus propias estadisticas; las ajenas quedan reservadas a administracion y oficiales");
    const [attendance, verifiedTasks, assignedShifts, assignedIncidents, inspections, participations, departures, missions, baseSheets] = await prisma_1.prisma.$transaction([
        prisma_1.prisma.attendance.findMany({ where: { userId, status: "CLOSED", checkInTrust: { not: "REJECTED" }, discardedAt: null, checkOutTrust: { not: "REJECTED" } }, select: { checkInAt: true, checkOutAt: true } }),
        prisma_1.prisma.workTask.count({ where: { status: "VERIFIED", officerApproved: true, members: { some: { userId, declinedAt: null } } } }),
        prisma_1.prisma.shiftAssignment.count({ where: { userId } }), prisma_1.prisma.incidentAssignment.count({ where: { userId } }), prisma_1.prisma.inspectionResponsible.count({ where: { userId, inspection: { voidedAt: null } } }),
        prisma_1.prisma.serviceParticipation.findMany({ where: (0, credited_services_1.creditedServices)(userId), select: { shiftId: true, incidentId: true, startedAt: true, endedAt: true } }),
        prisma_1.prisma.departureMember.findMany({ where: { userId, departure: { voidedAt: null } }, select: { departure: { select: { departedAt: true, returnedAt: true } } } }),
        prisma_1.prisma.missionCrew.findMany({ where: { userId, movement: { returnedAt: { not: null }, departure: { voidedAt: null } } }, select: { movement: { select: { incidentId: true, departedAt: true, returnedAt: true } } } }),
        prisma_1.prisma.incidentSheet.findMany({ where: { baseUserIds: { has: userId }, finalizedAt: { not: null }, incident: { voidedAt: null } }, select: { incidentId: true, finalizedAt: true, incident: { select: { occurredAt: true } } } }),
    ], { isolationLevel: "RepeatableRead" });
    const intervals = attendance.filter((row) => row.checkInAt && row.checkOutAt && row.checkOutAt > row.checkInAt).map((row) => ({ start: row.checkInAt.getTime(), end: row.checkOutAt.getTime() }));
    if (actor.userId !== userId)
        await prisma_1.prisma.auditLog.create({ data: { actorUserId: actor.userId, action: "PERSONAL_STATISTICS_VIEWED", entityType: "User", entityId: userId } });
    const services = [...participations.map((row) => ({ start: row.startedAt.getTime(), end: row.endedAt.getTime() })), ...departures.map(({ departure: d }) => ({ start: d.departedAt.getTime(), end: d.returnedAt.getTime() }))];
    const serviceMinutes = Math.floor((0, reports_service_1.unionMilliseconds)(services) / 60000);
    // E16: categorias separadas. El total acreditado es la union sin solapamientos (R04).
    const deployed = missions.map(({ movement: m }) => ({ start: m.departedAt.getTime(), end: m.returnedAt.getTime() }));
    const emergencies = baseSheets.map(sheet => ({ start: sheet.incident.occurredAt.getTime(), end: sheet.finalizedAt.getTime() }));
    const baseDuringEmergency = intervals.flatMap(p => emergencies.map(e => ({ start: Math.max(p.start, e.start), end: Math.min(p.end, e.end) }))).filter(r => r.end > r.start);
    const categories = { stationMinutes: Math.floor((0, reports_service_1.unionMilliseconds)(intervals) / 60000), deployedMinutes: Math.floor((0, reports_service_1.unionMilliseconds)(deployed) / 60000), baseDuringEmergencyMinutes: Math.floor((0, reports_service_1.unionMilliseconds)(baseDuringEmergency) / 60000), totalMinutes: Math.floor((0, reports_service_1.unionMilliseconds)([...intervals, ...services, ...deployed]) / 60000) };
    return { categories, workedMinutes: Math.floor((0, reports_service_1.unionMilliseconds)(intervals) / 60000), totalAccreditedMinutes: Math.floor((0, reports_service_1.unionMilliseconds)([...intervals, ...services]) / 60000), attendedDepartures: departures.length, closedAttendances: intervals.length, verifiedTasks, assignedShifts, assignedIncidents, inspections, attendedShifts: participations.filter((row) => row.shiftId).length, attendedIncidents: new Set([...participations.flatMap(row => row.incidentId ? [row.incidentId] : []), ...missions.map(row => row.movement.incidentId), ...baseSheets.map(row => row.incidentId)]).size, serviceMinutes };
}
