import { prisma } from "../../config/prisma";

export async function listAuditLogs(filters: {
  limit: number;
  entityType?: string;
  action?: string;
}) {
  return prisma.auditLog.findMany({
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
