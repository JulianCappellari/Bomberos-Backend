"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDashboardSummary = getDashboardSummary;
const prisma_1 = require("../../config/prisma");
const attendance_service_1 = require("../attendance/attendance.service");
const OPS_ROLES = new Set(["ADMIN", "OPERATOR"]);
const VEHICLE_CONTROL_INTERVAL_DAYS = 7;
const VEHICLE_CONTROL_DUE_SOON_DAYS = 2;
const DAY_MS = 24 * 60 * 60 * 1000;
function addDays(date, days) {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
}
function formatAlertTitle(type) {
    const labels = {
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
async function getDashboardSummary(userId, role) {
    const canSeeOps = OPS_ROLES.has(role) || role === "FIREFIGHTER";
    const [attendance, myOpenAttendance, recentAlerts, activeAlerts] = await Promise.all([
        (0, attendance_service_1.getMyAttendanceSummary)(userId),
        prisma_1.prisma.attendance.findFirst({
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
        prisma_1.prisma.alert.findMany({
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
        prisma_1.prisma.alert.count({
            where: {
                status: "ACTIVE",
            },
        }),
    ]);
    const baseSummary = {
        attendance,
        myOpenAttendance,
        activeAlerts,
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
    const [openIncidents, inStation, activeUsers, pendingApplications, totalVehicles, operationalVehicles, maintenanceVehicles, outOfServiceVehicles, vehiclesNeedingAttention, recentInspections, vehiclesForControl, recentActivity,] = await Promise.all([
        prisma_1.prisma.incident.count({
            where: {
                status: "OPEN",
            },
        }),
        prisma_1.prisma.attendance.count({
            where: {
                status: "OPEN",
            },
        }),
        prisma_1.prisma.user.count({
            where: {
                isActive: true,
                isPendingApproval: false,
                deletedAt: null,
            },
        }),
        prisma_1.prisma.volunteerApplication.count({
            where: {
                status: "PENDING",
            },
        }),
        prisma_1.prisma.asset.count({
            where: {
                assetType: "VEHICLE",
                deletedAt: null,
            },
        }),
        prisma_1.prisma.asset.count({
            where: {
                assetType: "VEHICLE",
                status: "OPERATIONAL",
                deletedAt: null,
            },
        }),
        prisma_1.prisma.asset.count({
            where: {
                assetType: "VEHICLE",
                status: "MAINTENANCE",
                deletedAt: null,
            },
        }),
        prisma_1.prisma.asset.count({
            where: {
                assetType: "VEHICLE",
                status: "OUT_OF_SERVICE",
                deletedAt: null,
            },
        }),
        prisma_1.prisma.asset.findMany({
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
        prisma_1.prisma.inspection.findMany({
            take: 5,
            orderBy: [{ inspectionDate: "desc" }, { createdAt: "desc" }],
            include: {
                vehicle: {
                    include: {
                        asset: true,
                    },
                },
            },
        }),
        prisma_1.prisma.vehicle.findMany({
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
                    take: 1,
                    orderBy: [{ inspectionDate: "desc" }, { createdAt: "desc" }],
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
        prisma_1.prisma.auditLog.findMany({
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
        }),
    ]);
    const now = new Date();
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
                readiness: "NO_CONTROL",
                lastInspectionAt: null,
                nextDueAt: null,
                daysSinceLastControl: null,
                summaryMissing: 0,
                summaryDamaged: 0,
                summaryUnchecked: 0,
            };
        }
        const nextDueAt = addDays(latestInspection.inspectionDate, VEHICLE_CONTROL_INTERVAL_DAYS);
        const daysUntilDue = Math.ceil((nextDueAt.getTime() - now.getTime()) / DAY_MS);
        const daysSinceLastControl = Math.max(0, Math.floor((now.getTime() - latestInspection.inspectionDate.getTime()) / DAY_MS));
        let readiness = "OK";
        if (latestInspection.summaryMissing > 0 ||
            latestInspection.summaryDamaged > 0 ||
            latestInspection.summaryUnchecked > 0) {
            readiness = "ISSUES";
        }
        else if (nextDueAt.getTime() < now.getTime()) {
            readiness = "OVERDUE";
        }
        else if (daysUntilDue <= VEHICLE_CONTROL_DUE_SOON_DAYS) {
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
    const vehicleControlsRequiringAttention = vehicleControlItems.filter((item) => item.readiness !== "OK");
    return {
        ...baseSummary,
        ops: {
            openIncidents,
            inStation,
            activeUsers,
            pendingApplications,
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
                withIssues: vehicleControlItems.filter((item) => item.readiness === "ISSUES").length,
                overdue: vehicleControlItems.filter((item) => item.readiness === "OVERDUE").length,
                dueSoon: vehicleControlItems.filter((item) => item.readiness === "DUE_SOON").length,
                withoutControl: vehicleControlItems.filter((item) => item.readiness === "NO_CONTROL").length,
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
