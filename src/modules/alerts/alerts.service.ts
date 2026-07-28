import { prisma } from "../../config/prisma";

function normalizeNullable(value?: string | null) {
  if (value === undefined || value === null || value === "") return null;
  return value;
}

export async function createAlert(data: {
  type: "FIRE" | "RESCUE" | "ACCIDENT" | "CHEMICAL" | "MEDICAL" | "FLOOD" | "OTHER";
  priority: "HIGH" | "MEDIUM" | "LOW";
  description?: string;
  location: string;
  contactPhone?: string | null;
  createdByUserId: string;
}) {
  const alert = await prisma.alert.create({
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

  await prisma.auditLog.create({
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

export async function getAllAlerts(status?: string, type?: string) {
  return prisma.alert.findMany({
    where: {
      ...(status ? { status: status as "ACTIVE" | "RESOLVED" | "CANCELLED" } : {}),
      ...(type
        ? {
            type: type as
              | "FIRE"
              | "RESCUE"
              | "ACCIDENT"
              | "CHEMICAL"
              | "MEDICAL"
              | "FLOOD"
              | "OTHER",
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

export async function getAlertById(alertId: string) {
  const alert = await prisma.alert.findUnique({
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

export async function resolveAlert(alertId: string, actorUserId: string) {
  const alert = await prisma.alert.findUnique({
    where: { id: alertId },
  });

  if (!alert) {
    throw new Error("Alert not found");
  }

  if (alert.status !== "ACTIVE") {
    throw new Error("Only active alerts can be resolved");
  }

  const updated = await prisma.alert.update({
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

  await prisma.auditLog.create({
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

export async function respondToAlert(
  alertId: string,
  userId: string,
  response: "GOING" | "NOT_GOING",
) {
  const alert = await prisma.alert.findUnique({
    where: { id: alertId },
  });

  if (!alert) {
    throw new Error("Alert not found");
  }

  if (alert.status !== "ACTIVE") {
    throw new Error("Cannot respond to a non-active alert");
  }

  const user = await prisma.user.findFirst({
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

  const alertResponse = await prisma.alertResponse.upsert({
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

  await prisma.auditLog.create({
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

export async function getAlertResponses(alertId: string) {
  const alert = await prisma.alert.findUnique({
    where: { id: alertId },
  });

  if (!alert) {
    throw new Error("Alert not found");
  }

  return prisma.alertResponse.findMany({
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
