"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createAlert = createAlert;
exports.getAllAlerts = getAllAlerts;
exports.getAlertById = getAlertById;
exports.resolveAlert = resolveAlert;
exports.cancelAlert = cancelAlert;
exports.respondToAlert = respondToAlert;
exports.getAlertResponses = getAlertResponses;
const prisma_1 = require("../../config/prisma");
const transaction_1 = require("../../utils/transaction");
const operations_schemas_1 = require("../operations/operations.schemas");
const public_user_1 = require("../../utils/public-user");
const alert_notifications_1 = require("./alert-notifications");
const notifications_service_1 = require("../members/notifications.service");
function normalizeNullable(value) {
    if (value === undefined || value === null || value === "")
        return null;
    return value;
}
async function createAlert(data) {
    return (0, transaction_1.serializable)(async (tx) => {
        const alert = await tx.alert.create({
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
                    select: public_user_1.PUBLIC_USER_SELECT,
                },
                resolvedBy: {
                    select: public_user_1.PUBLIC_USER_SELECT,
                },
                responses: {
                    include: {
                        user: {
                            select: public_user_1.PUBLIC_USER_SELECT,
                        },
                    },
                },
                incident: {
                    select: {
                        id: true,
                        title: true,
                        status: true,
                    },
                },
            },
        });
        await tx.auditLog.create({
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
        await (0, alert_notifications_1.notifyAlert)(tx, alert);
        return alert;
    });
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
                select: public_user_1.PUBLIC_USER_SELECT,
            },
            resolvedBy: {
                select: public_user_1.PUBLIC_USER_SELECT,
            },
            responses: {
                include: {
                    user: {
                        select: public_user_1.PUBLIC_USER_SELECT,
                    },
                },
            },
            incident: {
                select: {
                    id: true,
                    title: true,
                    status: true,
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
                select: public_user_1.PUBLIC_USER_SELECT,
            },
            resolvedBy: {
                select: public_user_1.PUBLIC_USER_SELECT,
            },
            responses: {
                include: {
                    user: {
                        select: public_user_1.PUBLIC_USER_SELECT,
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
        include: {
            incident: {
                select: { id: true, status: true },
            },
        },
    });
    if (!alert) {
        throw new Error("Alert not found");
    }
    if (alert.status !== "ACTIVE") {
        throw new Error("Only active alerts can be resolved");
    }
    if (alert.incident?.status === "OPEN") {
        throw new Error("La alerta tiene un incidente abierto; cerra el incidente para resolverla");
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
                select: public_user_1.PUBLIC_USER_SELECT,
            },
            resolvedBy: {
                select: public_user_1.PUBLIC_USER_SELECT,
            },
            responses: {
                include: {
                    user: {
                        select: public_user_1.PUBLIC_USER_SELECT,
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
async function cancelAlert(alertId, actorUserId, reason) {
    return (0, transaction_1.serializable)(async (tx) => {
        await tx.$queryRaw `SELECT "id" FROM "Alert" WHERE "id" = ${alertId} FOR UPDATE`;
        const alert = await tx.alert.findUnique({
            where: { id: alertId },
            include: { incident: { select: { id: true } } },
        });
        if (!alert)
            throw new operations_schemas_1.OperationError(404, "Alerta no encontrada");
        if (alert.status !== "ACTIVE")
            throw new operations_schemas_1.OperationError(409, "La alerta ya no está activa");
        const updated = await tx.alert.update({
            where: { id: alertId },
            data: { status: "CANCELLED", resolvedByUserId: actorUserId, resolvedAt: new Date() },
            include: {
                createdBy: { select: public_user_1.PUBLIC_USER_SELECT },
                resolvedBy: { select: public_user_1.PUBLIC_USER_SELECT },
                responses: { include: { user: { select: public_user_1.PUBLIC_USER_SELECT } } },
                incident: { select: { id: true, title: true, status: true } },
            },
        });
        await tx.auditLog.create({
            data: {
                actorUserId,
                action: "ALERT_CANCELLED",
                entityType: "Alert",
                entityId: alertId,
                metadata: { reason, incidentId: alert.incident?.id ?? null },
            },
        });
        await (0, notifications_service_1.notifyCommand)(tx, "Alerta cancelada", "/alerts", `${alert.location}: ${reason}`, actorUserId);
        return updated;
    });
}
async function respondToAlert(alertId, userId, response) {
    return (0, transaction_1.serializable)(async (tx) => {
        await tx.$queryRaw `SELECT "id" FROM "Alert" WHERE "id" = ${alertId} FOR UPDATE`;
        const alert = await tx.alert.findUnique({ where: { id: alertId } });
        if (!alert)
            throw new operations_schemas_1.OperationError(404, "Alerta no encontrada");
        if (alert.status !== "ACTIVE")
            throw new operations_schemas_1.OperationError(409, "La alerta ya no acepta respuestas");
        if (!await tx.user.findFirst({ where: { id: userId, deletedAt: null, isActive: true, isPendingApproval: false }, select: { id: true } }))
            throw new operations_schemas_1.OperationError(403, "Personal no habilitado");
        if (!await (0, alert_notifications_1.isAlertRecipient)(tx, alertId, userId))
            throw new operations_schemas_1.OperationError(403, "No integra la convocatoria de esta alerta: puede consultarla, pero no responder. Active su disponibilidad para recibirla");
        const previous = await tx.alertResponse.findUnique({ where: { alertId_userId: { alertId, userId } }, include: { user: { select: public_user_1.PUBLIC_USER_SELECT }, alert: true } });
        if (previous) {
            if (previous.response === response)
                return previous;
            const updated = await tx.alertResponse.update({
                where: { id: previous.id },
                data: { response, respondedAt: new Date() },
                include: { user: { select: public_user_1.PUBLIC_USER_SELECT }, alert: true },
            });
            await tx.auditLog.create({
                data: {
                    actorUserId: userId,
                    action: "ALERT_RESPONSE_CHANGED",
                    entityType: "Alert",
                    entityId: alertId,
                    metadata: { previousResponse: previous.response, response },
                },
            });
            return updated;
        }
        const result = await tx.alertResponse.create({ data: { alertId, userId, response }, include: { user: { select: public_user_1.PUBLIC_USER_SELECT }, alert: true } });
        await tx.auditLog.create({ data: { actorUserId: userId, action: "ALERT_RESPONDED", entityType: "Alert", entityId: alertId, metadata: { response } } });
        return result;
    });
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
                select: public_user_1.PUBLIC_USER_SELECT,
            },
        },
        orderBy: {
            respondedAt: "asc",
        },
    });
}
