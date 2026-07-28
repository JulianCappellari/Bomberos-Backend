"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listAuditLogs = listAuditLogs;
const prisma_1 = require("../../config/prisma");
async function listAuditLogs(filters) {
    return prisma_1.prisma.auditLog.findMany({
        where: {
            ...(filters.entityType ? { entityType: filters.entityType } : {}),
            ...(filters.action ? { action: filters.action } : {}),
        },
        include: {
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
        },
        orderBy: {
            createdAt: "desc",
        },
        take: filters.limit,
    });
}
