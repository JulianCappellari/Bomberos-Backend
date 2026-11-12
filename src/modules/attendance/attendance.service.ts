import { ownerOnGuardDuty } from "../users/guard-account.service";
import { gpsSuspicionReasons, recordGpsSuspicion, recordSharedDevice } from "../../utils/gps-suspicion";
import { prisma } from "../../config/prisma";
import { creditedServices } from "../incidents/credited-services";
import { effectiveAccessRole, normalizeRank } from "../../utils/firefighter-ranks";
import { OperationError } from "../operations/operations.schemas";
import { reportBounds, unionMilliseconds } from "../operations/reports.service";
import { stationDate } from "../../utils/station-time";
import { serializable } from "../../utils/transaction";
import { generatePlainToken, getDistanceMeters, sha256 } from "./attendance.utils";
import { onGuardNow } from "../shifts/on-guard";
import { sortByPerson } from "../../utils/people-order";
import { ORDER_FIELDS } from "../../utils/public-user";
import { effectivePresenceDue, windowTimes } from "../members/presence.service";
import { assertNotRestricted } from "../sanctions/sanctions";

const QR_EXPIRATION_SECONDS = 30;
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
  return serializable(async (prisma) => {
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
  await prisma.auditLog.create({ data: { actorUserId: createdByUserId || null, action: "STATION_QR_CREATED", entityType: "QrChallenge", entityId: challenge.id, metadata: { stationId, expiresAt: expiresAt.toISOString() } } });

  return {
    id: challenge.id,
    qrToken: plainToken,
    expiresAt: challenge.expiresAt,
    stationId: challenge.stationId,
  };
  });
}

export async function scanAttendanceQr(data: {
  actorRole?: string;
  userId: string;
  qrToken: string;
  latitude?: number;
  longitude?: number;
  accuracy?: number;
  deviceFingerprint: string;
  ip?: string;
}) {
  return serializable(async (prisma) => {
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

  // Base sin ubicacion: se ficha solo con el QR. En las demas la ubicacion es obligatoria.
  let distance = 0;
  if (station.requiresLocation) {
    if (typeof data.latitude !== "number" || typeof data.longitude !== "number") throw new OperationError(428, "Este cuartel pide tu ubicación para registrar la asistencia");
    distance = getDistanceMeters(data.latitude, data.longitude, station.latitude, station.longitude);
    if (typeof data.accuracy === "number" && data.accuracy > MAX_ALLOWED_ACCURACY_METERS) throw new Error("La precisión de ubicación es insuficiente");
    if (distance > Math.max(station.radiusMeters, MAX_ALLOWED_DISTANCE_METERS)) throw new Error("Estás fuera del rango permitido del cuartel");
  }

  const actor = await prisma.user.findUnique({ where: { id: data.userId }, include: { profile: true } });
  if (!actor || normalizeRank(actor.profile?.rank) === "administrador") throw new OperationError(403, "La cuenta administradora no registra asistencia personal");
  if (normalizeRank(actor.profile?.rank) === "comision directiva") throw new OperationError(403, "La Comisión Directiva no registra asistencia: es una cuenta de consulta, no de bombero");
  // Anti-fraude: quien muestra el QR como guardia no puede usarlo para su propia cuenta personal.
  const creator = challenge.createdByUserId ? await prisma.user.findUnique({ where: { id: challenge.createdByUserId }, select: { guardForUserId: true } }) : null;
  if (challenge.createdByUserId === data.userId || creator?.guardForUserId === data.userId) throw new OperationError(403, "No podés registrar tu asistencia con el QR que generaste vos. Otra persona de guardia o jefatura debe mostrarte el QR");
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

  let action: "CHECK_IN" | "CHECK_OUT";
  let attendance;

  if (!openAttendance) {
    if (data.actorRole === "GUARD" || effectiveAccessRole(actor.role, actor.profile?.rank) === "GUARD") throw new OperationError(403, "Guardia puede cerrar permanencias, pero no registrar ingresos");
    // Tampoco desde otro celular: mientras tenga la funcion de guardia abierta en algun dispositivo,
    // su cuenta personal no suma asistencia. Primero tiene que terminar la guardia.
    if (await ownerOnGuardDuty(prisma, data.userId)) throw new OperationError(403, "Tu cuenta de guardia está en uso. Cerrá sesión en la cuenta de guardia antes de registrar tu asistencia personal");
    // Sancion con suspension del servicio vigente: no suma asistencia.
    await assertNotRestricted(prisma, [data.userId], "SUSPENDED", "no puede registrar asistencia mientras dure la suspensión");
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
    if (station.requiresLocation && typeof data.latitude === "number" && typeof data.longitude === "number") await recordGpsSuspicion(prisma, data.userId, attendance.id, "Ingreso por QR", gpsSuspicionReasons({ ...data, latitude: data.latitude, longitude: data.longitude }, lastFix ? { latitude: lastFix.checkInLatitude, longitude: lastFix.checkInLongitude } : null));
    // Anti-fraude: el mismo celular ya ficho a otra persona en las ultimas 12 horas (posible fichaje por otro).
    await recordSharedDevice(prisma, data.userId, attendance.id, data.deviceFingerprint);

    await prisma.attendanceRecord.create({
      data: {
        userId: data.userId,
        type: "ENTRY",
        method: "QR",
        notes: `QR check-in en ${station.name}`,
      },
    });
  } else {
    if (openAttendance.stationId !== station.id) {
      throw new Error(
        `Tenes una asistencia abierta en ${openAttendance.station.name}. Cerrala antes de registrar ingreso en otro cuartel.`,
      );
    }

    action = "CHECK_OUT";

    const now = new Date();
    const { dueAt } = await effectivePresenceDue(prisma, data.userId, openAttendance);
    const capped = Boolean(dueAt && openAttendance.checkInQrId && now >= windowTimes(dueAt).expiresAt);
    const checkOutAt = capped && dueAt! > (openAttendance.checkInAt ?? dueAt!) ? dueAt! : now;

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
        checkOutMethod: capped ? "QR_CAPPED" : "QR",
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

  const shouldPromptAvailability = action === "CHECK_IN" && (
    !actor.emergencyStatusConfirmedAt ||
    Boolean(await prisma.emergencyAvailability.findFirst({
      where: {
        userId: data.userId,
        cancelledAt: null,
        startsAt: { lte: new Date() },
        OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }],
      },
      select: { id: true },
    }))
  );

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

export async function getPresentPersonnel() {
  const rows = await prisma.attendance.findMany({
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
              joinDate: true,
            },
          },
          ...ORDER_FIELDS,
        },
      },
    },
  });
  // Quien esta por una guardia se distingue de quien vino sin estar de guardia; listado en orden institucional.
  const guards = await onGuardNow(prisma, rows.map((r) => r.user.id));
  return sortByPerson(rows, (r) => r.user).map((r) => {
    const guard = guards.get(r.user.id);
    return { ...r, onGuard: Boolean(guard), guardLabel: guard?.label ?? null, guardUntil: guard?.until ?? null };
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
  const [attendances, participations, departures, openAttendance] = await prisma.$transaction([
    prisma.attendance.findMany({ where: { userId, status: "CLOSED", checkInTrust: { not: "REJECTED" }, discardedAt: null, checkOutTrust: { not: "REJECTED" } }, select: { checkInAt: true, checkOutAt: true } }),
    prisma.serviceParticipation.findMany({ where: creditedServices(userId), select: { startedAt: true, endedAt: true } }),
    prisma.departureMember.findMany({ where: { userId, departure: { voidedAt: null } }, select: { departure: { select: { departedAt: true, returnedAt: true } } } }),
    prisma.attendance.findFirst({ where: { userId, status: "OPEN" }, select: { id: true } }),
  ], { isolationLevel: "RepeatableRead" });
  const station = attendances.filter((a) => a.checkInAt && a.checkOutAt && a.checkOutAt > a.checkInAt).map((a) => ({ start: a.checkInAt!.getTime(), end: a.checkOutAt!.getTime() }));
  const services = [...participations.map((p) => ({ start: p.startedAt.getTime(), end: p.endedAt.getTime() })), ...departures.map(({ departure: d }) => ({ start: d.departedAt.getTime(), end: d.returnedAt.getTime() }))];
  const bounds = reportBounds(stationDate().slice(0, 7));
  const monthMinutes = (rows: Array<{ start: number; end: number }>) => Math.floor(unionMilliseconds(rows.map((r) => ({ start: Math.max(r.start, bounds.start.getTime()), end: Math.min(r.end, bounds.end.getTime()) })).filter((r) => r.end > r.start)) / 60000);
  const totalMinutes = Math.floor(unionMilliseconds(station) / 60000), currentMonthMinutes = monthMinutes(station);
  const creditedTotalMinutes = Math.floor(unionMilliseconds([...station, ...services]) / 60000), creditedMonthMinutes = monthMinutes([...station, ...services]);

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
