"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createAttendanceQrChallenge = createAttendanceQrChallenge;
exports.scanAttendanceQr = scanAttendanceQr;
exports.getMyOpenAttendance = getMyOpenAttendance;
exports.getPresentPersonnel = getPresentPersonnel;
exports.getMyAttendances = getMyAttendances;
exports.getMyAttendanceSummary = getMyAttendanceSummary;
const prisma_1 = require("../../config/prisma");
const attendance_utils_1 = require("./attendance.utils");
const QR_EXPIRATION_SECONDS = 60;
const MAX_ALLOWED_DISTANCE_METERS = 120;
const MAX_ALLOWED_ACCURACY_METERS = 2000; //cambiar a 150
function formatMinutes(totalMinutes) {
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${hours}h ${minutes}m`;
}
async function createAttendanceQrChallenge(stationId, createdByUserId) {
    const station = await prisma_1.prisma.station.findUnique({
        where: { id: stationId },
    });
    if (!station) {
        throw new Error("Station not found");
    }
    const plainToken = (0, attendance_utils_1.generatePlainToken)();
    const tokenHash = (0, attendance_utils_1.sha256)(plainToken);
    const expiresAt = new Date(Date.now() + QR_EXPIRATION_SECONDS * 1000);
    const challenge = await prisma_1.prisma.qrChallenge.create({
        data: {
            stationId,
            tokenHash,
            expiresAt,
            createdByUserId,
        },
    });
    return {
        id: challenge.id,
        qrToken: plainToken,
        expiresAt: challenge.expiresAt,
        stationId: challenge.stationId,
    };
}
async function scanAttendanceQr(data) {
    const tokenHash = (0, attendance_utils_1.sha256)(data.qrToken);
    const challenge = await prisma_1.prisma.qrChallenge.findFirst({
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
    const openAttendance = await prisma_1.prisma.attendance.findFirst({
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
        action = "CHECK_IN";
        attendance = await prisma_1.prisma.attendance.create({
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
        await prisma_1.prisma.attendanceRecord.create({
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
        attendance = await prisma_1.prisma.attendance.update({
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
        await prisma_1.prisma.attendanceRecord.create({
            data: {
                userId: data.userId,
                type: "EXIT",
                method: "QR",
                notes: `QR check-out en ${station.name}`,
            },
        });
    }
    await prisma_1.prisma.qrChallenge.update({
        where: { id: challenge.id },
        data: {
            consumedCount: {
                increment: 1,
            },
        },
    });
    return {
        action,
        station: {
            id: station.id,
            name: station.name,
        },
        attendance,
        workedMinutes: attendance.workedMinutes ?? 0,
        distanceMeters: Math.round(distance),
    };
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
    const attendances = await prisma_1.prisma.attendance.findMany({
        where: {
            userId,
            status: "CLOSED",
            workedMinutes: {
                not: null,
            },
        },
        select: {
            workedMinutes: true,
            checkInAt: true,
        },
    });
    const totalMinutes = attendances.reduce((acc, item) => acc + (item.workedMinutes ?? 0), 0);
    const now = new Date();
    const currentMonthMinutes = attendances
        .filter((item) => {
        if (!item.checkInAt)
            return false;
        const date = new Date(item.checkInAt);
        return (date.getMonth() === now.getMonth() &&
            date.getFullYear() === now.getFullYear());
    })
        .reduce((acc, item) => acc + (item.workedMinutes ?? 0), 0);
    const openAttendance = await prisma_1.prisma.attendance.findFirst({
        where: {
            userId,
            status: "OPEN",
        },
        select: {
            id: true,
        },
    });
    return {
        totalMinutes,
        totalHours: Math.floor(totalMinutes / 60),
        totalHoursFormatted: formatMinutes(totalMinutes),
        totalAttendances: attendances.length,
        currentMonthMinutes,
        currentMonthFormatted: formatMinutes(currentMonthMinutes),
        isCurrentlyInside: Boolean(openAttendance),
    };
}
