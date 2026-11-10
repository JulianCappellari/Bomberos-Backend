import { prisma } from "../../config/prisma";
import { isCommandRank } from "../../utils/firefighter-ranks";
import { stationDate } from "../../utils/station-time";
import { shiftInterval } from "../shifts/shifts.rules";

const VEHICLE_CONTROL_INTERVAL_DAYS = 7;
const RECOMMENDED_CREW_SIZE = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

function dateOnlyFromKey(key: string) {
  return new Date(`${key}T00:00:00.000Z`);
}

export function shiftPhase(
  date: Date,
  period: "DAY" | "NIGHT" | null,
  now: Date,
  storedStartTime: string,
  storedEndTime: string,
) {
  const key = date.toISOString().slice(0, 10);
  const startTime = period === "DAY" ? "08:00" : period === "NIGHT" ? "20:00" : storedStartTime;
  const endTime = period === "DAY" ? "20:00" : period === "NIGHT" ? "08:00" : storedEndTime;
  const { start, end } = shiftInterval(key, startTime, endTime);
  if (now.getTime() < start) return "UPCOMING" as const;
  if (now.getTime() >= end) return "FINISHED" as const;
  return "ACTIVE" as const;
}

export function evaluateOperationalReadiness(input: {
  presentCount: number;
  commandPresentCount: number;
  readyVehicleCount: number;
  recommendedCrewSize: number;
  activeShift: {
    assignedCount: number;
    presentAssignedCount: number;
  } | null;
}) {
  const blockingReasons = [
    ...(input.presentCount === 0
      ? ["No hay personal registrado en el cuartel."]
      : []),
    ...(input.readyVehicleCount === 0
      ? ["No hay vehiculos operativos con control vigente y sin novedades."]
      : []),
  ];
  const warnings = [
    ...(input.presentCount > 0 &&
    input.presentCount < input.recommendedCrewSize
      ? [
          `Dotacion reducida: ${input.presentCount} de ${input.recommendedCrewSize} personas recomendadas.`,
        ]
      : []),
    ...(input.presentCount > 0 && input.commandPresentCount === 0
      ? ["No hay un Oficial o Sub oficial presente."]
      : []),
    ...(!input.activeShift
      ? ["No hay una guardia activa en el horario actual."]
      : input.activeShift.presentAssignedCount < input.activeShift.assignedCount
        ? [
            `La guardia activa tiene ${input.activeShift.presentAssignedCount} de ${input.activeShift.assignedCount} integrantes presentes.`,
          ]
        : []),
  ];

  return {
    status:
      blockingReasons.length > 0
        ? ("NOT_READY" as const)
        : warnings.length > 0
          ? ("LIMITED" as const)
          : ("READY" as const),
    blockingReasons,
    warnings,
  };
}

export async function getOperationalReadiness() {
  const now = new Date();
  const today = dateOnlyFromKey(stationDate(now));
  const yesterday = new Date(today);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);

  const [presentAttendances, todayShifts, vehicles, activeAlerts] =
    await Promise.all([
      prisma.attendance.findMany({
        where: {
          status: "OPEN",
          checkInAt: { not: null },
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
          station: { select: { id: true, name: true } },
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
                },
              },
            },
          },
        },
        orderBy: { checkInAt: "asc" },
      }),
      prisma.shift.findMany({
        where: { date: { gte: yesterday, lte: today } },
        include: {
          assignments: {
            include: {
              user: {
                select: {
                  id: true,
                  username: true,
                  isActive: true,
                  isPendingApproval: true,
                  deletedAt: true,
                  profile: {
                    select: {
                      fullName: true,
                      rank: true,
                      badge: true,
                    },
                  },
                },
              },
            },
          },
        },
        orderBy: { startTime: "asc" },
      }),
      prisma.vehicle.findMany({
        where: {
          asset: {
            is: {
              assetType: "VEHICLE",
              deletedAt: null,
            },
          },
        },
        include: {
          compartments: { select: { items: { select: { expiresOn: true, state: true } } } },
          asset: true,
          inspections: {
            where: { voidedAt: null },
            take: 1,
            orderBy: [{ inspectionDate: "desc" }, { inspectionTime: "desc" }, { createdAt: "desc" }],
            select: {
              inspectionDate: true,
              summaryMissing: true,
              summaryDamaged: true,
              summaryUnchecked: true,
              items: { select: { foundElsewhere: true } },
            },
          },
        },
        orderBy: { unitNumber: "asc" },
      }),
      prisma.alert.findMany({
        where: { status: "ACTIVE" },
        select: {
          id: true,
          type: true,
          priority: true,
          location: true,
          createdAt: true,
          responses: {
            where: { response: "GOING" },
            select: { userId: true },
          },
        },
        orderBy: { createdAt: "desc" },
      }),
    ]);

  const presentUserIds = new Set(
    presentAttendances.map((attendance) => attendance.user.id),
  );
  const commandPresent = presentAttendances.filter((attendance) =>
    isCommandRank(attendance.user.profile?.rank),
  );

  const shiftCoverage = todayShifts.map((shift) => {
    const eligibleAssignments = shift.assignments.filter(
      (assignment) =>
        assignment.user.isActive &&
        !assignment.user.isPendingApproval &&
        !assignment.user.deletedAt,
    );
    const presentAssigned = eligibleAssignments.filter((assignment) =>
      presentUserIds.has(assignment.userId),
    );

    return {
      id: shift.id,
      shiftType: shift.shiftType,
      startTime: shift.startTime,
      endTime: shift.endTime,
      phase: shiftPhase(shift.date, shift.period, now, shift.startTime, shift.endTime),
      assignedCount: eligibleAssignments.length,
      presentAssignedCount: presentAssigned.length,
      coveragePercent:
        eligibleAssignments.length > 0
          ? Math.round(
              (presentAssigned.length / eligibleAssignments.length) * 100,
            )
          : 0,
      assignments: eligibleAssignments.map((assignment) => ({
        userId: assignment.userId,
        fullName:
          assignment.user.profile?.fullName ?? assignment.user.username,
        rank: assignment.user.profile?.rank ?? null,
        isPresent: presentUserIds.has(assignment.userId),
      })),
    };
  });

  const vehicleReadiness = vehicles.map((vehicle) => {
    const inspection = vehicle.inspections[0] ?? null;
    const hasIssues = Boolean(
      inspection &&
        (inspection.summaryMissing > 0 ||
          inspection.summaryDamaged > 0 ||
          inspection.summaryUnchecked > 0 || inspection.items.some((i) => i.foundElsewhere)),
    );
    const controlExpiresAt = inspection
      ? new Date(
          inspection.inspectionDate.getTime() +
            VEHICLE_CONTROL_INTERVAL_DAYS * DAY_MS,
        )
      : null;
    const controlOverdue = !controlExpiresAt || controlExpiresAt < now;
    const blockers = [
      ...(vehicle.compartments.some((c) => c.items.some((i) => i.expiresOn && i.expiresOn < today)) ? ["Material con vencimiento superado"] : []),
      ...(vehicle.compartments.some((c) => c.items.some((i) => i.state !== "OK")) ? ["Inventario con materiales pendientes de revision"] : []),
      ...(vehicle.asset.status !== "OPERATIONAL"
        ? [vehicle.asset.status === "OUT_OF_SERVICE" ? "Fuera de servicio" : vehicle.asset.status === "MAINTENANCE" ? "En mantenimiento" : `Estado ${vehicle.asset.status}`]
        : []),
      ...(!inspection ? ["Sin control registrado"] : []),
      ...(inspection && hasIssues ? ["Control con novedades"] : []),
      ...(inspection && !hasIssues && controlOverdue
        ? ["Control vencido"]
        : []),
    ];

    return {
      vehicleId: vehicle.id,
      vehicleAssetId: vehicle.asset.id,
      name: vehicle.asset.name,
      unitNumber: vehicle.unitNumber,
      plate: vehicle.plate,
      status: vehicle.asset.status,
      ready: blockers.length === 0,
      blockers,
      lastInspectionAt: inspection?.inspectionDate ?? null,
      controlExpiresAt,
    };
  });

  const activeShift = shiftCoverage.find((shift) => shift.phase === "ACTIVE");
  const readyVehicles = vehicleReadiness.filter((vehicle) => vehicle.ready);
  const evaluation = evaluateOperationalReadiness({
    presentCount: presentAttendances.length,
    commandPresentCount: commandPresent.length,
    readyVehicleCount: readyVehicles.length,
    recommendedCrewSize: RECOMMENDED_CREW_SIZE,
    activeShift: activeShift
      ? {
          assignedCount: activeShift.assignedCount,
          presentAssignedCount: activeShift.presentAssignedCount,
        }
      : null,
  });

  return {
    generatedAt: now,
    status: evaluation.status,
    recommendedCrewSize: RECOMMENDED_CREW_SIZE,
    blockingReasons: evaluation.blockingReasons,
    warnings: evaluation.warnings,
    personnel: {
      presentCount: presentAttendances.length,
      commandPresentCount: commandPresent.length,
      items: presentAttendances.map((attendance) => ({
        attendanceId: attendance.id,
        userId: attendance.user.id,
        username: attendance.user.username,
        fullName:
          attendance.user.profile?.fullName ?? attendance.user.username,
        rank: attendance.user.profile?.rank ?? null,
        badge: attendance.user.profile?.badge ?? null,
        checkInAt: attendance.checkInAt,
        checkInTrust: attendance.checkInTrust,
        station: attendance.station,
        isCommand: isCommandRank(attendance.user.profile?.rank),
      })),
    },
    shifts: {
      activeShiftId: activeShift?.id ?? null,
      items: shiftCoverage,
    },
    vehicles: {
      total: vehicleReadiness.length,
      readyCount: readyVehicles.length,
      items: vehicleReadiness,
    },
    alerts: {
      activeCount: activeAlerts.length,
      items: activeAlerts.map((alert) => ({
        ...alert,
        goingCount: alert.responses.length,
        presentResponderCount: alert.responses.filter((response) =>
          presentUserIds.has(response.userId),
        ).length,
      })),
    },
  };
}
