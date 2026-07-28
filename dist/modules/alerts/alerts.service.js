"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createAlert = createAlert;
exports.getAllAlerts = getAllAlerts;
exports.getAlertById = getAlertById;
exports.resolveAlert = resolveAlert;
exports.respondToAlert = respondToAlert;
exports.getAlertResponses = getAlertResponses;
const prisma_1 = require("../../config/prisma");
function normalizeNullable(value) {
    if (value === undefined || value === null || value === "")
        return null;
    return value;
}
async function createAlert(data) {
    const alert = await prisma_1.prisma.alert.create({
        data: {
            type: data.type,
            priority: data.priority,
            description: data.description || "",
            location: data.location,
            contactPhone: normalizeNullable(data.contactPhone),
            status: "ACTIVE",
            createdByUserId: data.createdByUserId,
        },
        include: {
            createdBy: {
                include: {
                    profile: true,
                },
            },
            resolvedBy: {
                include: {
                    profile: true,
                },
            },
            responses: {
                include: {
                    user: {
                        include: {
                            profile: true,
                        },
                    },
                },
            },
        },
    });
    await prisma_1.prisma.auditLog.create({
        data: {
            actorUserId: data.createdByUserId,
            action: "ALERT_CREATED",
            entityType: "Alert",
            entityId: alert.id,
            metadata: {
                type: alert.type,
                priority: alert.priority,
                location: alert.location,
            },
        },
    });
    return alert;
}
async function getAllAlerts(status, type) {
    return prisma_1.prisma.alert.findMany({
        where: {
            ...(status ? { status: status } : {}),
            ...(type
                ? {
                    type: type,
                }
                : {}),
        },
        include: {
            createdBy: {
                include: {
                    profile: true,
                },
            },
            resolvedBy: {
                include: {
                    profile: true,
                },
            },
            responses: {
                include: {
                    user: {
                        include: {
                            profile: true,
                        },
                    },
                },
            },
        },
        orderBy: {
            createdAt: "desc",
        },
    });
}
async function getAlertById(alertId) {
    const alert = await prisma_1.prisma.alert.findUnique({
        where: { id: alertId },
        include: {
            createdBy: {
                include: {
                    profile: true,
                },
            },
            resolvedBy: {
                include: {
                    profile: true,
                },
            },
            responses: {
                include: {
                    user: {
                        include: {
                            profile: true,
                        },
                    },
                },
            },
        },
    });
    if (!alert) {
        throw new Error("Alert not found");
    }
    return alert;
}
async function resolveAlert(alertId, actorUserId) {
    const alert = await prisma_1.prisma.alert.findUnique({
        where: { id: alertId },
    });
    if (!alert) {
        throw new Error("Alert not found");
    }
    if (alert.status !== "ACTIVE") {
        throw new Error("Only active alerts can be resolved");
    }
    const updated = await prisma_1.prisma.alert.update({
        where: { id: alertId },
        data: {
            status: "RESOLVED",
            resolvedByUserId: actorUserId,
            resolvedAt: new Date(),
        },
        include: {
            createdBy: {
                include: {
                    profile: true,
                },
            },
            resolvedBy: {
                include: {
                    profile: true,
                },
            },
            responses: {
                include: {
                    user: {
                        include: {
                            profile: true,
                        },
                    },
                },
            },
        },
    });
    await prisma_1.prisma.auditLog.create({
        data: {
            actorUserId,
            action: "ALERT_RESOLVED",
            entityType: "Alert",
            entityId: updated.id,
            metadata: {
                type: updated.type,
                status: updated.status,
            },
        },
    });
    return updated;
}
async function respondToAlert(alertId, userId, response) {
    const alert = await prisma_1.prisma.alert.findUnique({
        where: { id: alertId },
    });
    if (!alert) {
        throw new Error("Alert not found");
    }
    if (alert.status !== "ACTIVE") {
        throw new Error("Cannot respond to a non-active alert");
    }
    const user = await prisma_1.prisma.user.findFirst({
        where: {
            id: userId,
            deletedAt: null,
            isActive: true,
            isPendingApproval: false,
        },
    });
    if (!user) {
        throw new Error("User not found or inactive");
    }
    const alertResponse = await prisma_1.prisma.alertResponse.upsert({
        where: {
            alertId_userId: {
                alertId,
                userId,
            },
        },
        update: {
            response,
            respondedAt: new Date(),
        },
        create: {
            alertId,
            userId,
            response,
        },
        include: {
            user: {
                include: {
                    profile: true,
                },
            },
            alert: true,
        },
    });
    await prisma_1.prisma.auditLog.create({
        data: {
            actorUserId: userId,
            action: "ALERT_RESPONDED",
            entityType: "Alert",
            entityId: alertId,
            metadata: {
                response,
            },
        },
    });
    return alertResponse;
}
async function getAlertResponses(alertId) {
    const alert = await prisma_1.prisma.alert.findUnique({
        where: { id: alertId },
    });
    if (!alert) {
        throw new Error("Alert not found");
    }
    return prisma_1.prisma.alertResponse.findMany({
        where: { alertId },
        include: {
            user: {
                include: {
                    profile: true,
                },
            },
        },
        orderBy: {
            respondedAt: "asc",
        },
    });
}
