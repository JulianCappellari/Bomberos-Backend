"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listAuditLogs = listAuditLogs;
const prisma_1 = require("../../config/prisma");
const AUDIT_LOG_INCLUDE = {
    actor: {
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
};
async function listAuditLogs(filters) {
    const and = [];
    if (filters.entityType) {
        and.push({
            entityType: {
                contains: filters.entityType,
                mode: "insensitive",
            },
        });
    }
    if (filters.action) {
        and.push({
            action: {
                contains: filters.action,
                mode: "insensitive",
            },
        });
    }
    if (filters.from || filters.to) {
        and.push({
            createdAt: {
                ...(filters.from ? { gte: filters.from } : {}),
                ...(filters.to ? { lte: filters.to } : {}),
            },
        });
    }
    const logs = await prisma_1.prisma.auditLog.findMany({
        where: and.length > 0 ? { AND: and } : undefined,
        include: AUDIT_LOG_INCLUDE,
        orderBy: {
            createdAt: "desc",
        },
        take: filters.q ? Math.min(filters.limit * 8, 500) : filters.limit,
    });
    if (!filters.q) {
        return logs;
    }
    const query = filters.q.toLowerCase();
    return logs
        .filter((log) => auditLogMatchesQuery(log, query))
        .slice(0, filters.limit);
}
function auditLogMatchesQuery(log, query) {
    const searchableText = [
        log.action,
        log.entityType,
        log.entityId,
        log.actor?.username,
        log.actor?.role,
        log.actor?.profile?.fullName,
        log.actor?.profile?.rank,
        log.actor?.profile?.badge,
        metadataText(log.metadata),
    ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
    return searchableText.includes(query);
}
function metadataText(metadata) {
    if (metadata === null)
        return "";
    try {
        return JSON.stringify(metadata);
    }
    catch {
        return "";
    }
}
