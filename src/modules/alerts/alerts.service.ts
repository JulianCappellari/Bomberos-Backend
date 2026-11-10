import { prisma } from "../../config/prisma";
import { serializable } from "../../utils/transaction";
import { OperationError } from "../operations/operations.schemas";
import { PUBLIC_USER_SELECT } from "../../utils/public-user";
import { isAlertRecipient, notifyAlert } from "./alert-notifications";
import { notifyCommand } from "../members/notifications.service";

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
  return serializable(async tx => {
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
        select: PUBLIC_USER_SELECT,
      },
      resolvedBy: {
        select: PUBLIC_USER_SELECT,
      },
      responses: {
        include: {
          user: {
            select: PUBLIC_USER_SELECT,
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

  await notifyAlert(tx, alert);
  return alert;
  });
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
        select: PUBLIC_USER_SELECT,
      },
      resolvedBy: {
        select: PUBLIC_USER_SELECT,
      },
      responses: {
        include: {
          user: {
            select: PUBLIC_USER_SELECT,
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

export async function getAlertById(alertId: string) {
  const alert = await prisma.alert.findUnique({
    where: { id: alertId },
    include: {
      createdBy: {
        select: PUBLIC_USER_SELECT,
      },
      resolvedBy: {
        select: PUBLIC_USER_SELECT,
      },
      responses: {
        include: {
          user: {
            select: PUBLIC_USER_SELECT,
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
    throw new Error(
      "La alerta tiene un incidente abierto; cerra el incidente para resolverla",
    );
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
        select: PUBLIC_USER_SELECT,
      },
      resolvedBy: {
        select: PUBLIC_USER_SELECT,
      },
      responses: {
        include: {
          user: {
            select: PUBLIC_USER_SELECT,
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

export async function cancelAlert(alertId: string, actorUserId: string, reason: string) {
  return serializable(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Alert" WHERE "id" = ${alertId} FOR UPDATE`;
    const alert = await tx.alert.findUnique({
      where: { id: alertId },
      include: { incident: { select: { id: true } } },
    });
    if (!alert) throw new OperationError(404, "Alerta no encontrada");
    if (alert.status !== "ACTIVE") throw new OperationError(409, "La alerta ya no está activa");
    const updated = await tx.alert.update({
      where: { id: alertId },
      data: { status: "CANCELLED", resolvedByUserId: actorUserId, resolvedAt: new Date() },
      include: {
        createdBy: { select: PUBLIC_USER_SELECT },
        resolvedBy: { select: PUBLIC_USER_SELECT },
        responses: { include: { user: { select: PUBLIC_USER_SELECT } } },
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
    await notifyCommand(tx, "Alerta cancelada", "/alerts", `${alert.location}: ${reason}`, actorUserId);
    return updated;
  });
}

export async function respondToAlert(alertId: string, userId: string, response: "GOING" | "NOT_GOING") {
  return serializable(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Alert" WHERE "id" = ${alertId} FOR UPDATE`;
    const alert = await tx.alert.findUnique({ where: { id: alertId } });
    if (!alert) throw new OperationError(404, "Alerta no encontrada");
    if (alert.status !== "ACTIVE") throw new OperationError(409, "La alerta ya no acepta respuestas");
    if (!await tx.user.findFirst({ where: { id: userId, deletedAt: null, isActive: true, isPendingApproval: false }, select: { id: true } })) throw new OperationError(403, "Personal no habilitado");
    if (!await isAlertRecipient(tx, alertId, userId)) throw new OperationError(403, "No integra la convocatoria de esta alerta: puede consultarla, pero no responder. Active su disponibilidad para recibirla");
    const previous = await tx.alertResponse.findUnique({ where: { alertId_userId: { alertId, userId } }, include: { user: { select: PUBLIC_USER_SELECT }, alert: true } });
    if (previous) {
      if (previous.response === response) return previous;
      const updated = await tx.alertResponse.update({
        where: { id: previous.id },
        data: { response, respondedAt: new Date() },
        include: { user: { select: PUBLIC_USER_SELECT }, alert: true },
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
    const result = await tx.alertResponse.create({ data: { alertId, userId, response }, include: { user: { select: PUBLIC_USER_SELECT }, alert: true } });
    await tx.auditLog.create({ data: { actorUserId: userId, action: "ALERT_RESPONDED", entityType: "Alert", entityId: alertId, metadata: { response } } });
    return result;
  });
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
        select: PUBLIC_USER_SELECT,
      },
    },
    orderBy: {
      respondedAt: "asc",
    },
  });
}
