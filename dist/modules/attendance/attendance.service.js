"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createAttendanceQrChallenge = createAttendanceQrChallenge;
exports.scanAttendanceQr = scanAttendanceQr;
exports.getMyOpenAttendance = getMyOpenAttendance;
exports.getPresentPersonnel = getPresentPersonnel;
exports.getMyAttendances = getMyAttendances;
exports.getMyAttendanceSummary = getMyAttendanceSummary;
const gps_suspicion_1 = require("../../utils/gps-suspicion");
const prisma_1 = require("../../config/prisma");
const credited_services_1 = require("../incidents/credited-services");
const firefighter_ranks_1 = require("../../utils/firefighter-ranks");
const operations_schemas_1 = require("../operations/operations.schemas");
const reports_service_1 = require("../operations/reports.service");
const station_time_1 = require("../../utils/station-time");
const transaction_1 = require("../../utils/transaction");
const attendance_utils_1 = require("./attendance.utils");
const QR_EXPIRATION_SECONDS = 30;
const MAX_ALLOWED_DISTANCE_METERS = 120;
const MAX_ALLOWED_ACCURACY_METERS = 2000; //cambiar a 150
function formatMinutes(totalMinutes) {
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${hours}h ${minutes}m`;
}
async function createAttendanceQrChallenge(stationId, createdByUserId) {
    return (0, transaction_1.serializable)(async (prisma) => {
        const station = await prisma.station.findUnique({
            where: { id: stationId },
        });
        if (!station) {
            throw new Error("Station not found");
        }
        const now = new Date();
        await prisma.qrChallenge.updateMany({
            where: { stationId, revokedAt: null, expiresAt: { gt: now } },
            data: { revokedAt: now },
        });
        const plainToken = (0, attendance_utils_1.generatePlainToken)();
        const tokenHash = (0, attendance_utils_1.sha256)(plainToken);
        const expiresAt = new Date(Date.now() + QR_EXPIRATION_SECONDS * 1000);
        const challenge = await prisma.qrChallenge.create({
            data: {
                stationId,
                tokenHash,
                expiresAt,
                createdByUserId,
            },
        });
        await prisma.auditLog.create({ data: { actorUserId: createdByUserId || null, action: "STATION_QR_CREATED", entityType: "QrChallenge", entityId: challenge.id, metadata: { stationId, expiresAt: expiresAt.toISOString() } } });
        return {
            id: challenge.id,
            qrToken: plainToken,
            expiresAt: challenge.expiresAt,
            stationId: challenge.stationId,
        };
    });
}
async function scanAttendanceQr(data) {
    return (0, transaction_1.serializable)(async (prisma) => {
        const tokenHash = (0, attendance_utils_1.sha256)(data.qrToken);
        const challenge = await prisma.qrChallenge.findFirst({
            where: {
                tokenHash,
                revokedAt: null,
            },
            include: {
                station: true,
            },
        });
        if (!challenge) {
            throw new Error("QR inválido");
        }
        if (challenge.expiresAt.getTime() < Date.now()) {
            throw new Error("QR vencido");
        }
        const station = challenge.station;
        const distance = (0, attendance_utils_1.getDistanceMeters)(data.latitude, data.longitude, station.latitude, station.longitude);
        if (typeof data.accuracy === "number" &&
            data.accuracy > MAX_ALLOWED_ACCURACY_METERS) {
            throw new Error("La precisión de ubicación es insuficiente");
        }
        if (distance > Math.max(station.radiusMeters, MAX_ALLOWED_DISTANCE_METERS)) {
            throw new Error("Estás fuera del rango permitido del cuartel");
        }
        const actor = await prisma.user.findUnique({ where: { id: data.userId }, include: { profile: true } });
        if (!actor || (0, firefighter_ranks_1.normalizeRank)(actor.profile?.rank) === "administrador")
            throw new operations_schemas_1.OperationError(403, "La cuenta administradora no registra asistencia personal");
        const openAttendance = await prisma.attendance.findFirst({
            where: {
                userId: data.userId,
                status: "OPEN",
            },
            include: {
                station: true,
            },
            orderBy: {
                createdAt: "desc",
            },
        });
        let action;
        let attendance;
        if (!openAttendance) {
            if (data.actorRole === "GUARD" || (0, firefighter_ranks_1.effectiveAccessRole)(actor.role, actor.profile?.rank) === "GUARD")
                throw new operations_schemas_1.OperationError(403, "Guardia puede cerrar permanencias, pero no registrar ingresos");
            action = "CHECK_IN";
            attendance = await prisma.attendance.create({
                data: {
                    userId: data.userId,
                    stationId: station.id,
                    status: "OPEN",
                    checkInAt: new Date(),
                    workedMinutes: null,
                    checkInTrust: "HIGH",
                    checkInLatitude: data.latitude,
                    checkInLongitude: data.longitude,
                    checkInAccuracy: data.accuracy,
                    checkInIp: data.ip,
                    checkInDevice: data.deviceFingerprint,
                    checkInQrId: challenge.id,
                },
            });
            // T09: una ubicacion con senales de falsificacion se marca y audita, sin bloquear el ingreso.
            const lastFix = await prisma.attendance.findFirst({ where: { userId: data.userId, id: { not: attendance.id } }, orderBy: { createdAt: "desc" }, select: { checkInLatitude: true, checkInLongitude: true } });
            await (0, gps_suspicion_1.recordGpsSuspicion)(prisma, data.userId, attendance.id, "Ingreso por QR", (0, gps_suspicion_1.gpsSuspicionReasons)(data, lastFix ? { latitude: lastFix.checkInLatitude, longitude: lastFix.checkInLongitude } : null));
            await prisma.attendanceRecord.create({
                data: {
                    userId: data.userId,
                    type: "ENTRY",
                    method: "QR",
                    notes: `QR check-in en ${station.name}`,
                },
            });
        }
        else {
            if (openAttendance.stationId !== station.id) {
                throw new Error(`Tenes una asistencia abierta en ${openAttendance.station.name}. Cerrala antes de registrar ingreso en otro cuartel.`);
            }
            action = "CHECK_OUT";
            const checkOutAt = new Date();
            const workedMinutes = openAttendance.checkInAt
                ? Math.max(0, Math.floor((checkOutAt.getTime() - openAttendance.checkInAt.getTime()) / 60000))
                : 0;
            attendance = await prisma.attendance.update({
                where: { id: openAttendance.id },
                data: {
                    status: "CLOSED",
                    checkOutAt,
                    workedMinutes,
                    checkOutTrust: "HIGH",
                    checkOutLatitude: data.latitude,
                    checkOutLongitude: data.longitude,
                    checkOutAccuracy: data.accuracy,
                    checkOutIp: data.ip,
                    checkOutDevice: data.deviceFingerprint,
                    checkOutQrId: challenge.id,
                },
            });
            await prisma.attendanceRecord.create({
                data: {
                    userId: data.userId,
                    type: "EXIT",
                    method: "QR",
                    notes: `QR check-out en ${station.name}`,
                },
            });
        }
        await prisma.qrChallenge.update({
            where: { id: challenge.id },
            data: {
                consumedCount: {
                    increment: 1,
                },
            },
        });
        const shouldPromptAvailability = action === "CHECK_IN" && (!actor.emergencyStatusConfirmedAt ||
            Boolean(await prisma.emergencyAvailability.findFirst({
                where: {
                    userId: data.userId,
                    cancelledAt: null,
                    startsAt: { lte: new Date() },
                    OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }],
                },
                select: { id: true },
            })));
        return {
            action,
            shouldPromptAvailability,
            station: {
                id: station.id,
                name: station.name,
            },
            attendance,
            workedMinutes: attendance.workedMinutes ?? 0,
            distanceMeters: Math.round(distance),
        };
    });
}
async function getMyOpenAttendance(userId) {
    return prisma_1.prisma.attendance.findFirst({
        where: {
            userId,
            status: "OPEN",
        },
        include: {
            station: true,
        },
        orderBy: {
            createdAt: "desc",
        },
    });
}
async function getPresentPersonnel() {
    return prisma_1.prisma.attendance.findMany({
        where: {
            status: "OPEN",
            checkInAt: {
                not: null,
            },
            user: {
                missionCrew: { none: { movement: { returnedAt: null } } },
                deletedAt: null,
                isActive: true,
                isPendingApproval: false,
            },
        },
        select: {
            id: true,
            checkInAt: true,
            checkInTrust: true,
            station: {
                select: {
                    id: true,
                    name: true,
                },
            },
            user: {
                select: {
                    id: true,
                    username: true,
                    role: true,
                    profile: {
                        select: {
                            fullName: true,
                            rank: true,
                            badge: true,
                            avatarUrl: true,
                        },
                    },
                },
            },
        },
        orderBy: {
            checkInAt: "desc",
        },
    });
}
async function getMyAttendances(userId) {
    return prisma_1.prisma.attendance.findMany({
        where: { userId },
        include: {
            station: true,
        },
        orderBy: {
            createdAt: "desc",
        },
    });
}
async function getMyAttendanceSummary(userId) {
    const [attendances, participations, departures, openAttendance] = await prisma_1.prisma.$transaction([
        prisma_1.prisma.attendance.findMany({ where: { userId, status: "CLOSED", checkInTrust: { not: "REJECTED" }, discardedAt: null, checkOutTrust: { not: "REJECTED" } }, select: { checkInAt: true, checkOutAt: true } }),
        prisma_1.prisma.serviceParticipation.findMany({ where: (0, credited_services_1.creditedServices)(userId), select: { startedAt: true, endedAt: true } }),
        prisma_1.prisma.departureMember.findMany({ where: { userId, departure: { voidedAt: null } }, select: { departure: { select: { departedAt: true, returnedAt: true } } } }),
        prisma_1.prisma.attendance.findFirst({ where: { userId, status: "OPEN" }, select: { id: true } }),
    ], { isolationLevel: "RepeatableRead" });
    const station = attendances.filter((a) => a.checkInAt && a.checkOutAt && a.checkOutAt > a.checkInAt).map((a) => ({ start: a.checkInAt.getTime(), end: a.checkOutAt.getTime() }));
    const services = [...participations.map((p) => ({ start: p.startedAt.getTime(), end: p.endedAt.getTime() })), ...departures.map(({ departure: d }) => ({ start: d.departedAt.getTime(), end: d.returnedAt.getTime() }))];
    const bounds = (0, reports_service_1.reportBounds)((0, station_time_1.stationDate)().slice(0, 7));
    const monthMinutes = (rows) => Math.floor((0, reports_service_1.unionMilliseconds)(rows.map((r) => ({ start: Math.max(r.start, bounds.start.getTime()), end: Math.min(r.end, bounds.end.getTime()) })).filter((r) => r.end > r.start)) / 60000);
    const totalMinutes = Math.floor((0, reports_service_1.unionMilliseconds)(station) / 60000), currentMonthMinutes = monthMinutes(station);
    const creditedTotalMinutes = Math.floor((0, reports_service_1.unionMilliseconds)([...station, ...services]) / 60000), creditedMonthMinutes = monthMinutes([...station, ...services]);
    return {
        totalMinutes,
        totalHours: Math.floor(totalMinutes / 60),
        totalHoursFormatted: formatMinutes(totalMinutes),
        totalAttendances: station.length,
        creditedTotalMinutes,
        creditedMonthMinutes,
        creditedMonthFormatted: formatMinutes(creditedMonthMinutes),
        currentMonthMinutes,
        currentMonthFormatted: formatMinutes(currentMonthMinutes),
        isCurrentlyInside: Boolean(openAttendance),
    };
}
