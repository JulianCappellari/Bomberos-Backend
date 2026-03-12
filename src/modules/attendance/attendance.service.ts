import { prisma } from "../../config/prisma";
import { generatePlainToken, getDistanceMeters, sha256 } from "./attendance.utils";

const QR_EXPIRATION_SECONDS = 60;
const MAX_ALLOWED_DISTANCE_METERS = 120;
const MAX_ALLOWED_ACCURACY_METERS = 2000; //cambiar a 150

function formatMinutes(totalMinutes: number) {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${minutes}m`;
}


export async function createAttendanceQrChallenge(
  stationId: string,
  createdByUserId?: string,
) {
  const station = await prisma.station.findUnique({
    where: { id: stationId },
  });

  if (!station) {
    throw new Error("Station not found");
  }

  const plainToken = generatePlainToken();
  const tokenHash = sha256(plainToken);
  const expiresAt = new Date(Date.now() + QR_EXPIRATION_SECONDS * 1000);

  const challenge = await prisma.qrChallenge.create({
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

export async function scanAttendanceQr(data: {
  userId: string;
  qrToken: string;
  latitude: number;
  longitude: number;
  accuracy?: number;
  deviceFingerprint: string;
  ip?: string;
}) {
  const tokenHash = sha256(data.qrToken);

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

  const distance = getDistanceMeters(
    data.latitude,
    data.longitude,
    station.latitude,
    station.longitude,
  );

  if (
    typeof data.accuracy === "number" &&
    data.accuracy > MAX_ALLOWED_ACCURACY_METERS
  ) {
    throw new Error("La precisión de ubicación es insuficiente");
  }

  if (distance > Math.max(station.radiusMeters, MAX_ALLOWED_DISTANCE_METERS)) {
    throw new Error("Estás fuera del rango permitido del cuartel");
  }

  const openAttendance = await prisma.attendance.findFirst({
    where: {
      userId: data.userId,
      stationId: station.id,
      status: "OPEN",
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  let action: "CHECK_IN" | "CHECK_OUT";
  let attendance;

  if (!openAttendance) {
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

    await prisma.attendanceRecord.create({
      data: {
        userId: data.userId,
        type: "ENTRY",
        method: "QR",
        notes: `QR check-in en ${station.name}`,
      },
    });
  } else {
    action = "CHECK_OUT";

    const checkOutAt = new Date();

    const workedMinutes = openAttendance.checkInAt
      ? Math.max(
          0,
          Math.floor(
            (checkOutAt.getTime() - openAttendance.checkInAt.getTime()) / 60000,
          ),
        )
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
export async function getMyOpenAttendance(userId: string) {
  return prisma.attendance.findFirst({
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

export async function getMyAttendances(userId: string) {
  return prisma.attendance.findMany({
    where: { userId },
    include: {
      station: true,
    },
    orderBy: {
      createdAt: "desc",
    },
  });
}

export async function getMyAttendanceSummary(userId: string) {
  const attendances = await prisma.attendance.findMany({
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

  const totalMinutes = attendances.reduce(
    (acc, item) => acc + (item.workedMinutes ?? 0),
    0,
  );

  const now = new Date();
  const currentMonthMinutes = attendances
    .filter((item) => {
      if (!item.checkInAt) return false;
      const date = new Date(item.checkInAt);
      return (
        date.getMonth() === now.getMonth() &&
        date.getFullYear() === now.getFullYear()
      );
    })
    .reduce((acc, item) => acc + (item.workedMinutes ?? 0), 0);

  const openAttendance = await prisma.attendance.findFirst({
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