"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createIncident = createIncident;
exports.getAllIncidents = getAllIncidents;
exports.getIncidentById = getIncidentById;
exports.updateIncident = updateIncident;
exports.closeIncident = closeIncident;
exports.assignUsersToIncident = assignUsersToIncident;
const prisma_1 = require("../../config/prisma");
function normalizeNullable(value) {
    if (value === undefined || value === null || value === "")
        return null;
    return value;
}
function uniqueUserIds(userIds) {
    return Array.from(new Set(userIds));
}
async function ensureUsersExist(userIds) {
    if (!userIds.length)
        return;
    const users = await prisma_1.prisma.user.findMany({
        where: {
            id: { in: userIds },
            deletedAt: null,
            isActive: true,
            isPendingApproval: false,
        },
        select: { id: true },
    });
    const foundIds = new Set(users.map((u) => u.id));
    const missing = userIds.filter((id) => !foundIds.has(id));
    if (missing.length > 0) {
        throw new Error(`Some users do not exist or are inactive: ${missing.join(", ")}`);
    }
}
async function createIncident(data) {
    const assignedUserIds = uniqueUserIds(data.assignedUserIds || []);
    if (data.alertId) {
        const alert = await prisma_1.prisma.alert.findUnique({
            where: { id: data.alertId },
        });
        if (!alert) {
            throw new Error("Alert not found");
        }
        if (alert.status === "CANCELLED") {
            throw new Error("Cannot create an incident from a cancelled alert");
        }
        if (alert.type !== data.type) {
            throw new Error("Incident type must match the linked alert type");
        }
    }
    await ensureUsersExist(assignedUserIds);
    const incident = await prisma_1.prisma.incident.create({
        data: {
            alertId: data.alertId || null,
            title: data.title,
            type: data.type,
            description: data.description,
            losses: normalizeNullable(data.losses),
            status: "OPEN",
            createdByUserId: data.createdByUserId,
            assignments: assignedUserIds.length
                ? {
                    create: assignedUserIds.map((userId) => ({
                        userId,
                    })),
                }
                : undefined,
        },
        include: {
            alert: true,
            createdBy: {
                include: { profile: true },
            },
            closedBy: {
                include: { profile: true },
            },
            assignments: {
                include: {
                    user: {
                        include: { profile: true },
                    },
                },
            },
        },
    });
    await prisma_1.prisma.auditLog.create({
        data: {
            actorUserId: data.createdByUserId,
            action: "INCIDENT_CREATED",
            entityType: "Incident",
            entityId: incident.id,
            metadata: {
                title: incident.title,
                type: incident.type,
                alertId: incident.alertId,
            },
        },
    });
    return incident;
}
async function getAllIncidents(status) {
    return prisma_1.prisma.incident.findMany({
        where: status
            ? {
                status: status,
            }
            : undefined,
        include: {
            alert: true,
            createdBy: {
                include: { profile: true },
            },
            closedBy: {
                include: { profile: true },
            },
            assignments: {
                include: {
                    user: {
                        include: { profile: true },
                    },
                },
            },
        },
        orderBy: {
            occurredAt: "desc",
        },
    });
}
async function getIncidentById(incidentId) {
    const incident = await prisma_1.prisma.incident.findUnique({
        where: { id: incidentId },
        include: {
            alert: true,
            createdBy: {
                include: { profile: true },
            },
            closedBy: {
                include: { profile: true },
            },
            assignments: {
                include: {
                    user: {
                        include: { profile: true },
                    },
                },
            },
        },
    });
    if (!incident) {
        throw new Error("Incident not found");
    }
    return incident;
}
async function updateIncident(incidentId, data, actorUserId) {
    const existing = await prisma_1.prisma.incident.findUnique({
        where: { id: incidentId },
    });
    if (!existing) {
        throw new Error("Incident not found");
    }
    if (existing.status !== "OPEN") {
        throw new Error("Only open incidents can be updated");
    }
    if (existing.alertId && data.type && data.type !== existing.type) {
        const alert = await prisma_1.prisma.alert.findUnique({
            where: { id: existing.alertId },
            select: { type: true },
        });
        if (alert && alert.type !== data.type) {
            throw new Error("Incident type must match the linked alert type");
        }
    }
    const updated = await prisma_1.prisma.incident.update({
        where: { id: incidentId },
        data: {
            title: data.title,
            type: data.type,
            description: data.description,
            losses: data.losses !== undefined ? normalizeNullable(data.losses) : undefined,
        },
        include: {
            alert: true,
            createdBy: {
                include: { profile: true },
            },
            closedBy: {
                include: { profile: true },
            },
            assignments: {
                include: {
                    user: {
                        include: { profile: true },
                    },
                },
            },
        },
    });
    await prisma_1.prisma.auditLog.create({
        data: {
            actorUserId: actorUserId || null,
            action: "INCIDENT_UPDATED",
            entityType: "Incident",
            entityId: updated.id,
            metadata: {
                title: updated.title,
                type: updated.type,
            },
        },
    });
    return updated;
}
async function closeIncident(incidentId, actorUserId) {
    const incident = await prisma_1.prisma.incident.findUnique({
        where: { id: incidentId },
    });
    if (!incident) {
        throw new Error("Incident not found");
    }
    if (incident.status !== "OPEN") {
        throw new Error("Only open incidents can be closed");
    }
    return prisma_1.prisma.$transaction(async (tx) => {
        const closedAt = new Date();
        const updated = await tx.incident.update({
            where: { id: incidentId },
            data: {
                status: "CLOSED",
                closedByUserId: actorUserId,
                closedAt,
            },
            include: {
                alert: true,
                createdBy: {
                    include: { profile: true },
                },
                closedBy: {
                    include: { profile: true },
                },
                assignments: {
                    include: {
                        user: {
                            include: { profile: true },
                        },
                    },
                },
            },
        });
        if (incident.alertId) {
            await tx.alert.updateMany({
                where: {
                    id: incident.alertId,
                    status: "ACTIVE",
                },
                data: {
                    status: "RESOLVED",
                    resolvedByUserId: actorUserId,
                    resolvedAt: closedAt,
                },
            });
        }
        await tx.auditLog.create({
            data: {
                actorUserId,
                action: "INCIDENT_CLOSED",
                entityType: "Incident",
                entityId: updated.id,
                metadata: {
                    title: updated.title,
                    alertId: updated.alertId,
                },
            },
        });
        if (incident.alertId) {
            await tx.auditLog.create({
                data: {
                    actorUserId,
                    action: "ALERT_RESOLVED_BY_INCIDENT_CLOSE",
                    entityType: "Alert",
                    entityId: incident.alertId,
                    metadata: {
                        incidentId: updated.id,
                    },
                },
            });
        }
        return updated;
    });
}
async function assignUsersToIncident(incidentId, userIds, actorUserId) {
    const incident = await prisma_1.prisma.incident.findUnique({
        where: { id: incidentId },
    });
    if (!incident) {
        throw new Error("Incident not found");
    }
    if (incident.status !== "OPEN") {
        throw new Error("Only open incidents can receive assignments");
    }
    const uniqueIds = uniqueUserIds(userIds);
    await ensureUsersExist(uniqueIds);
    const existingAssignments = await prisma_1.prisma.incidentAssignment.findMany({
        where: {
            incidentId,
            userId: { in: uniqueIds },
        },
        select: { userId: true },
    });
    const existingUserIds = new Set(existingAssignments.map((a) => a.userId));
    const newUserIds = uniqueIds.filter((id) => !existingUserIds.has(id));
    if (newUserIds.length > 0) {
        await prisma_1.prisma.incidentAssignment.createMany({
            data: newUserIds.map((userId) => ({
                incidentId,
                userId,
            })),
        });
    }
    await prisma_1.prisma.auditLog.create({
        data: {
            actorUserId: actorUserId || null,
            action: "INCIDENT_USERS_ASSIGNED",
            entityType: "Incident",
            entityId: incidentId,
            metadata: {
                assignedUserIds: uniqueIds,
            },
        },
    });
    return getIncidentById(incidentId);
}
