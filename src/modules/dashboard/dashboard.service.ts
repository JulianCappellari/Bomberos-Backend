import { prisma } from "../../config/prisma";
import { getMyAttendanceSummary } from "../attendance/attendance.service";
import { evaluateComplianceStatus } from "../compliance/compliance.service";

const OPS_ROLES = new Set(["ADMIN", "OPERATOR", "GUARD"]);
const VEHICLE_CONTROL_INTERVAL_DAYS = 7;
const VEHICLE_CONTROL_DUE_SOON_DAYS = 2;
const DAY_MS = 24 * 60 * 60 * 1000;

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function localDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateOnlyFromKey(key: string) {
  return new Date(`${key}T00:00:00.000Z`);
}

function formatAlertTitle(type: string) {
  const labels: Record<string, string> = {
    FIRE: "Incendio",
    RESCUE: "Rescate",
    ACCIDENT: "Accidente",
    CHEMICAL: "Químico",
    MEDICAL: "Médico",
    FLOOD: "Inundación",
    OTHER: "Alerta",
  };

  return labels[type] ?? "Alerta";
}

const SHIFT_SUMMARY_INCLUDE = {
  assignments: {
    include: {
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
  },
} as const;

function mapShiftSummary(shift: {
  id: string;
  date: Date;
  startTime: string;
  endTime: string;
  shiftType: string;
  notes: string | null;
  assignments: Array<{
    id: string;
    user: {
      id: string;
      username: string;
      role: string;
      profile: {
        fullName: string;
        rank: string;
        badge: string;
      } | null;
    };
  }>;
}) {
  return {
    id: shift.id,
    date: shift.date,
    startTime: shift.startTime,
    endTime: shift.endTime,
    shiftType: shift.shiftType,
    notes: shift.notes,
    assignedCount: shift.assignments.length,
    assignments: shift.assignments.map((assignment) => ({
      id: assignment.id,
      user: {
        id: assignment.user.id,
        username: assignment.user.username,
        role: assignment.user.role,
        fullName: assignment.user.profile?.fullName ?? null,
        rank: assignment.user.profile?.rank ?? null,
        badge: assignment.user.profile?.badge ?? null,
      },
    })),
  };
}

export async function getDashboardSummary(userId: string, role: string) {
  const canSeeOps = OPS_ROLES.has(role) || role === "FIREFIGHTER";
  const now = new Date();
  const todayKey = localDateKey(now);
  const todayDate = dateOnlyFromKey(todayKey);
  const shiftRangeStart = now.getHours() < 8
    ? dateOnlyFromKey(localDateKey(addDays(now, -1)))
    : todayDate;
  const upcomingToDate = dateOnlyFromKey(localDateKey(addDays(now, 14)));

  const [
    attendance,
    myOpenAttendance,
    recentAlerts,
    activeAlerts,
    myUpcomingShifts,
  ] =
    await Promise.all([
      getMyAttendanceSummary(userId),
      prisma.attendance.findFirst({
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
      }),
      prisma.alert.findMany({
        where: {
          status: "ACTIVE",
        },
        take: 3,
        orderBy: {
          createdAt: "desc",
        },
        include: {
          createdBy: {
            include: {
              profile: true,
            },
          },
          responses: true,
        },
      }),
      prisma.alert.count({
        where: {
          status: "ACTIVE",
        },
      }),
      prisma.shift.findMany({
        where: {
          date: {
            gte: shiftRangeStart,
            lte: upcomingToDate,
          },
          assignments: {
            some: {
              userId,
            },
          },
        },
        take: 5,
        orderBy: [{ date: "asc" }, { startTime: "asc" }],
        include: SHIFT_SUMMARY_INCLUDE,
      }),
    ]);

  const baseSummary = {
    attendance,
    myOpenAttendance,
    activeAlerts,
    myUpcomingShifts: myUpcomingShifts.map(mapShiftSummary),
    recentAlerts: recentAlerts.map((alert) => ({
      id: alert.id,
      title: formatAlertTitle(alert.type),
      type: alert.type,
      priority: alert.priority,
      status: alert.status,
      location: alert.location,
      description: alert.description,
      createdAt: alert.createdAt,
      createdBy: {
        id: alert.createdBy.id,
        username: alert.createdBy.username,
        fullName: alert.createdBy.profile?.fullName ?? null,
      },
      responsesCount: alert.responses.length,
    })),
    ops: null,
  };

  if (!canSeeOps) {
    return baseSummary;
  }

  const [
    openIncidents,
    inStation,
    activeUsers,
    pendingApplications,
    totalVehicles,
    operationalVehicles,
    maintenanceVehicles,
    outOfServiceVehicles,
    vehiclesNeedingAttention,
    recentInspections,
    vehiclesForControl,
    todayShifts,
    recentActivity,
    complianceExpirations,
  ] = await Promise.all([
    prisma.incident.count({
      where: {
        status: "OPEN",
      },
    }),
    prisma.attendance.count({
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
    }),
    prisma.user.count({
      where: {
        isActive: true,
        isPendingApproval: false,
        deletedAt: null,
      },
    }),
    prisma.volunteerApplication.count({
      where: {
        status: "PENDING",
      },
    }),
    prisma.asset.count({
      where: {
        assetType: "VEHICLE",
        deletedAt: null,
      },
    }),
    prisma.asset.count({
      where: {
        assetType: "VEHICLE",
        status: "OPERATIONAL",
        deletedAt: null,
      },
    }),
    prisma.asset.count({
      where: {
        assetType: "VEHICLE",
        status: "MAINTENANCE",
        deletedAt: null,
      },
    }),
    prisma.asset.count({
      where: {
        assetType: "VEHICLE",
        status: "OUT_OF_SERVICE",
        deletedAt: null,
      },
    }),
    prisma.asset.findMany({
      where: {
        assetType: "VEHICLE",
        status: {
          in: ["MAINTENANCE", "OUT_OF_SERVICE"],
        },
        deletedAt: null,
      },
      take: 5,
      orderBy: {
        updatedAt: "desc",
      },
      include: {
        vehicle: true,
      },
    }),
    prisma.inspection.findMany({
      take: 5,
      orderBy: [{ inspectionDate: "desc" }, { inspectionTime: "desc" }, { createdAt: "desc" }],
      include: {
        vehicle: {
          include: {
            asset: true,
          },
        },
      },
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
        asset: true,
        inspections: {
          where: { voidedAt: null },
          take: 1,
          orderBy: [{ inspectionDate: "desc" }, { inspectionTime: "desc" }, { createdAt: "desc" }],
          select: {
            id: true,
            inspectionDate: true,
            summaryMissing: true,
            summaryDamaged: true,
            summaryUnchecked: true,
          },
        },
      },
    }),
    prisma.shift.findMany({
      where: {
        date: { gte: shiftRangeStart, lte: todayDate },
      },
      orderBy: [{ startTime: "asc" }],
      include: SHIFT_SUMMARY_INCLUDE,
    }),
    role === "ADMIN" ? prisma.auditLog.findMany({
      take: 8,
      orderBy: {
        createdAt: "desc",
      },
      include: {
        actor: {
          include: {
            profile: true,
          },
        },
      },
    }) : Promise.resolve([]),
    OPS_ROLES.has(role) ? prisma.complianceRecord.findMany({
      where: { deletedAt: null, expiresAt: { not: null } },
      select: { expiresAt: true, warningDays: true },
    }) : Promise.resolve([]),
  ]);

  const vehicleControlItems = vehiclesForControl.map((vehicle) => {
    const latestInspection = vehicle.inspections[0] ?? null;

    if (!latestInspection) {
      return {
        vehicleId: vehicle.id,
        vehicleAssetId: vehicle.asset.id,
        name: vehicle.asset.name,
        status: vehicle.asset.status,
        unitNumber: vehicle.unitNumber,
        plate: vehicle.plate,
        readiness: "NO_CONTROL" as const,
        lastInspectionAt: null,
        nextDueAt: null,
        daysSinceLastControl: null,
        summaryMissing: 0,
        summaryDamaged: 0,
        summaryUnchecked: 0,
      };
    }

    const nextDueAt = addDays(
      latestInspection.inspectionDate,
      VEHICLE_CONTROL_INTERVAL_DAYS,
    );
    const daysUntilDue = Math.ceil(
      (nextDueAt.getTime() - now.getTime()) / DAY_MS,
    );
    const daysSinceLastControl = Math.max(
      0,
      Math.floor(
        (now.getTime() - latestInspection.inspectionDate.getTime()) / DAY_MS,
      ),
    );

    let readiness: "OK" | "ISSUES" | "OVERDUE" | "DUE_SOON" = "OK";
    if (
      latestInspection.summaryMissing > 0 ||
      latestInspection.summaryDamaged > 0 ||
      latestInspection.summaryUnchecked > 0
    ) {
      readiness = "ISSUES";
    } else if (nextDueAt.getTime() < now.getTime()) {
      readiness = "OVERDUE";
    } else if (daysUntilDue <= VEHICLE_CONTROL_DUE_SOON_DAYS) {
      readiness = "DUE_SOON";
    }

    return {
      vehicleId: vehicle.id,
      vehicleAssetId: vehicle.asset.id,
      name: vehicle.asset.name,
      status: vehicle.asset.status,
      unitNumber: vehicle.unitNumber,
      plate: vehicle.plate,
      readiness,
      lastInspectionAt: latestInspection.inspectionDate,
      nextDueAt,
      daysSinceLastControl,
      summaryMissing: latestInspection.summaryMissing,
      summaryDamaged: latestInspection.summaryDamaged,
      summaryUnchecked: latestInspection.summaryUnchecked,
    };
  });
  const vehicleControlsRequiringAttention = vehicleControlItems.filter(
    (item) => item.readiness !== "OK",
  );
  const activeAlertsWithoutResponses = recentAlerts.filter(
    (alert) => alert.responses.length === 0,
  ).length;
  const todayShiftsWithoutStaff = todayShifts.filter(
    (shift) => shift.assignments.length === 0,
  ).length;
  const complianceRequiringAttention = complianceExpirations.filter((record) =>
    ["EXPIRED", "DUE_SOON"].includes(
      evaluateComplianceStatus(record.expiresAt, record.warningDays, now).status,
    ),
  ).length;
  const operationalWarnings = [
    ...(todayShifts.length === 0
      ? [
          {
            code: "NO_SHIFT_TODAY",
            severity: "HIGH" as const,
            message: "No hay guardias cargadas para hoy.",
            href: "/calendar",
          },
        ]
      : []),
    ...(todayShiftsWithoutStaff > 0
      ? [
          {
            code: "SHIFT_WITHOUT_STAFF",
            severity: "HIGH" as const,
            message: todayShiftsWithoutStaff === 1 ? "Una guardia de hoy no tiene personal asignado." : `${todayShiftsWithoutStaff} guardias de hoy no tienen personal asignado.`,
            href: "/calendar",
          },
        ]
      : []),
    ...(activeAlertsWithoutResponses > 0
      ? [
          {
            code: "ACTIVE_ALERT_WITHOUT_RESPONSES",
            severity: "MEDIUM" as const,
            message: activeAlertsWithoutResponses === 1 ? "Una alerta activa todavía no tiene respuestas." : `${activeAlertsWithoutResponses} alertas activas todavía no tienen respuestas.`,
            href: "/alerts",
          },
        ]
      : []),
    ...(vehicleControlsRequiringAttention.length > 0
      ? [
          {
            code: "VEHICLE_CONTROLS_ATTENTION",
            severity: "MEDIUM" as const,
            message: vehicleControlsRequiringAttention.length === 1 ? "Un móvil necesita revisar su control semanal." : `${vehicleControlsRequiringAttention.length} móviles necesitan revisar su control semanal.`,
            href: "/equipment",
          },
        ]
      : []),
    ...(complianceRequiringAttention > 0
      ? [
          {
            code: "COMPLIANCE_ATTENTION",
            severity: "MEDIUM" as const,
            message: complianceRequiringAttention === 1 ? "Un vencimiento requiere atención." : `${complianceRequiringAttention} vencimientos requieren atención.`,
            href: "/compliance",
          },
        ]
      : []),
  ];

  return {
    ...baseSummary,
    ops: {
      openIncidents,
      inStation,
      activeUsers,
      pendingApplications,
      todayShifts: todayShifts.map(mapShiftSummary),
      operationalWarnings,
      vehicles: {
        total: totalVehicles,
        operational: operationalVehicles,
        maintenance: maintenanceVehicles,
        outOfService: outOfServiceVehicles,
      },
      vehiclesNeedingAttention: vehiclesNeedingAttention.map((asset) => ({
        id: asset.id,
        name: asset.name,
        status: asset.status,
        unitNumber: asset.vehicle?.unitNumber ?? null,
        plate: asset.vehicle?.plate ?? null,
        updatedAt: asset.updatedAt,
      })),
      vehicleControls: {
        intervalDays: VEHICLE_CONTROL_INTERVAL_DAYS,
        dueSoonDays: VEHICLE_CONTROL_DUE_SOON_DAYS,
        ok: vehicleControlItems.filter((item) => item.readiness === "OK").length,
        withIssues: vehicleControlItems.filter(
          (item) => item.readiness === "ISSUES",
        ).length,
        overdue: vehicleControlItems.filter(
          (item) => item.readiness === "OVERDUE",
        ).length,
        dueSoon: vehicleControlItems.filter(
          (item) => item.readiness === "DUE_SOON",
        ).length,
        withoutControl: vehicleControlItems.filter(
          (item) => item.readiness === "NO_CONTROL",
        ).length,
        items: vehicleControlsRequiringAttention.slice(0, 5),
      },
      recentInspections: recentInspections.map((inspection) => ({
        id: inspection.id,
        vehicleAssetId: inspection.vehicle.asset.id,
        vehicleName: inspection.vehicle.asset.name,
        inspectionDate: inspection.inspectionDate,
        inspectionTime: inspection.inspectionTime,
        summaryOk: inspection.summaryOk,
        summaryMissing: inspection.summaryMissing,
        summaryDamaged: inspection.summaryDamaged,
        summaryUnchecked: inspection.summaryUnchecked,
      })),
      recentActivity: recentActivity.map((entry) => ({
        id: entry.id,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        createdAt: entry.createdAt,
        actor: entry.actor
          ? {
              id: entry.actor.id,
              username: entry.actor.username,
              fullName: entry.actor.profile?.fullName ?? null,
            }
          : null,
      })),
    },
  };
}
