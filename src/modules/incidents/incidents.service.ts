import { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma";
import { OperationError } from "../operations/operations.schemas";
import { finalizeSheet } from "./incident-sheet";
import { PUBLIC_USER_SELECT } from "../../utils/public-user";
import { requireQrPresence } from "../../utils/require-qr-presence";

const ALERT_TYPE_LABELS = {
  FIRE: "Incendio",
  RESCUE: "Rescate",
  ACCIDENT: "Accidente",
  CHEMICAL: "Emergencia quimica",
  MEDICAL: "Emergencia medica",
  FLOOD: "Inundacion",
  OTHER: "Emergencia",
} as const;

export class IncidentConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IncidentConflictError";
  }
}

export function selectEligibleResponderIds(
  responses: ReadonlyArray<{
    userId: string;
    response: "GOING" | "NOT_GOING";
    user: {
      isActive: boolean;
      isPendingApproval: boolean;
      deletedAt: Date | null;
    };
  }>,
) {
  return responses
    .filter(
      (item) =>
        item.response === "GOING" &&
        item.user.isActive &&
        !item.user.isPendingApproval &&
        !item.user.deletedAt,
    )
    .map((item) => item.userId);
}

function normalizeNullable(value?: string | null) {
  if (value === undefined || value === null || value === "") return null;
  return value;
}

function uniqueUserIds(userIds: string[]) {
  return Array.from(new Set(userIds));
}

function uniqueIds(ids: string[]) {
  return Array.from(new Set(ids));
}

async function ensureUsersExist(userIds: string[]) {
  if (!userIds.length) return;

  const users = await prisma.user.findMany({
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

export async function createIncident(data: {
  alertId?: string | null;
  title: string;
  type: "FIRE" | "RESCUE" | "ACCIDENT" | "CHEMICAL" | "MEDICAL" | "FLOOD" | "OTHER";
  description: string;
  location: string;
  responseTimeMinutes?: number;
  losses?: string | null;
  assignedUserIds?: string[];
  vehicleAssetIds?: string[];
  createdByUserId: string;
}) {
  const assignedUserIds = uniqueUserIds(data.assignedUserIds || []);
  const vehicleAssetIds = uniqueIds(data.vehicleAssetIds || []);

  if (data.alertId) {
    const alert = await prisma.alert.findUnique({
      where: { id: data.alertId },
    });

    if (!alert) {
      throw new Error("Alerta no encontrada");
    }

    if (alert.status !== "ACTIVE") {
      throw new Error("Solo una alerta activa puede generar un incidente");
    }

    if (alert.type !== data.type) {
      throw new Error("Incident type must match the linked alert type");
    }

    const existingIncident = await prisma.incident.findUnique({
      where: { alertId: data.alertId },
      select: { id: true },
    });

    if (existingIncident) {
      throw new IncidentConflictError(
        "La alerta ya tiene un incidente asociado",
      );
    }
  }

  await ensureUsersExist(assignedUserIds);
  await ensureVehicleAssetsExist(vehicleAssetIds);

  const incident = await prisma.incident.create({
    data: {
      alertId: data.alertId || null,
      title: data.title,
      type: data.type,
      description: data.description,
      location: data.location,
      responseTimeMinutes: data.responseTimeMinutes,
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
      vehicles: vehicleAssetIds.length
        ? { create: vehicleAssetIds.map((assetId) => ({ assetId })) }
        : undefined,
    },
    include: {
      alert: true,
      createdBy: {
        select: PUBLIC_USER_SELECT,
      },
      closedBy: {
        select: PUBLIC_USER_SELECT,
      },
      assignments: {
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

async function ensureVehicleAssetsExist(assetIds: string[]) {
  if (!assetIds.length) return;
  const assets = await prisma.asset.findMany({
    where: {
      id: { in: assetIds },
      assetType: "VEHICLE",
      status: "OPERATIONAL",
      deletedAt: null,
    },
    select: { id: true },
  });
  const foundIds = new Set(assets.map((asset) => asset.id));
  const missing = assetIds.filter((id) => !foundIds.has(id));
  if (missing.length) {
    throw new Error(`Vehiculos inexistentes o no operativos: ${missing.join(", ")}`);
  }
}

export async function dispatchIncidentFromAlert(data: {
  alertId: string;
  title?: string;
  description?: string;
  autoAssignResponders: boolean;
  createdByUserId: string;
}) {
  const alert = await prisma.alert.findUnique({
    where: { id: data.alertId },
    include: {
      incident: {
        select: { id: true, title: true, status: true },
      },
      responses: {
        where: { response: "GOING" },
        include: {
          user: {
            select: {
              id: true,
              isActive: true,
              isPendingApproval: true,
              deletedAt: true,
            },
          },
        },
      },
    },
  });

  if (!alert) {
    throw new Error("Alerta no encontrada");
  }

  if (alert.status !== "ACTIVE") {
    throw new Error("Solo una alerta activa puede despachar un operativo");
  }

  if (alert.incident) {
    throw new IncidentConflictError(
      "La alerta ya tiene un incidente asociado",
    );
  }

  const responderIds = data.autoAssignResponders
    ? selectEligibleResponderIds(alert.responses)
    : [];

  try {
    return await prisma.$transaction(async (tx) => {
      const incident = await tx.incident.create({
        data: {
          alertId: alert.id,
          title:
            data.title ||
            `${ALERT_TYPE_LABELS[alert.type]} - ${alert.location}`.slice(0, 140),
          type: alert.type,
          description:
            data.description ||
            alert.description ||
            `Operativo despachado en ${alert.location}.`,
          location: alert.location,
          status: "OPEN",
          occurredAt: new Date(),
          createdByUserId: data.createdByUserId,
          assignments: responderIds.length
            ? {
                create: responderIds.map((userId) => ({ userId })),
              }
            : undefined,
        },
        include: {
          alert: true,
          createdBy: { select: PUBLIC_USER_SELECT },
          closedBy: { select: PUBLIC_USER_SELECT },
          assignments: {
            include: { user: { select: PUBLIC_USER_SELECT } },
          },
        },
      });

      await tx.auditLog.create({
        data: {
          actorUserId: data.createdByUserId,
          action: "INCIDENT_DISPATCHED_FROM_ALERT",
          entityType: "Incident",
          entityId: incident.id,
          metadata: {
            alertId: alert.id,
            autoAssignedResponderCount: responderIds.length,
          },
        },
      });

      return incident;
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new IncidentConflictError(
        "La alerta ya tiene un incidente asociado",
      );
    }
    throw error;
  }
}

export async function getAllIncidents(status?: string) {
  return prisma.incident.findMany({
    where: status
      ? {
          status: status as "OPEN" | "CLOSED",
        }
      : undefined,
    include: {
      alert: true,
      createdBy: {
        select: PUBLIC_USER_SELECT,
      },
      closedBy: {
        select: PUBLIC_USER_SELECT,
      },
      assignments: {
        include: {
          user: {
            select: PUBLIC_USER_SELECT,
          },
        },
      },
      vehicles: { include: { asset: { include: { vehicle: true } } } },
      updates: {
        where: { deletedAt: null },
        include: { author: { select: PUBLIC_USER_SELECT } },
        orderBy: { createdAt: "asc" },
      },
    },
    orderBy: {
      occurredAt: "desc",
    },
  });
}

export async function getIncidentById(incidentId: string) {
  const incident = await prisma.incident.findUnique({
    where: { id: incidentId },
    include: {
      alert: true,
      createdBy: {
        select: PUBLIC_USER_SELECT,
      },
      closedBy: {
        select: PUBLIC_USER_SELECT,
      },
      assignments: {
        include: {
          user: {
            select: PUBLIC_USER_SELECT,
          },
        },
      },
      vehicles: { include: { asset: { include: { vehicle: true } } } },
      updates: {
        where: { deletedAt: null },
        include: { author: { select: PUBLIC_USER_SELECT } },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!incident) {
    throw new Error("Intervención no encontrada");
  }

  return incident;
}

export async function updateIncident(
  incidentId: string,
  data: {
    title?: string;
    type?: "FIRE" | "RESCUE" | "ACCIDENT" | "CHEMICAL" | "MEDICAL" | "FLOOD" | "OTHER";
    description?: string;
    location?: string;
    responseTimeMinutes?: number | null;
    losses?: string | null;
  },
  actorUserId?: string,
) {
  const existing = await prisma.incident.findUnique({
    where: { id: incidentId },
  });

  if (!existing) {
    throw new Error("Intervención no encontrada");
  }

  if (existing.status !== "OPEN") {
    throw new Error("Only open incidents can be updated");
  }

  if (existing.alertId && data.type && data.type !== existing.type) {
    const alert = await prisma.alert.findUnique({
      where: { id: existing.alertId },
      select: { type: true },
    });

    if (alert && alert.type !== data.type) {
      throw new Error("Incident type must match the linked alert type");
    }
  }

  const updated = await prisma.incident.update({
    where: { id: incidentId },
    data: {
      title: data.title,
      type: data.type,
      description: data.description,
      location: data.location,
      responseTimeMinutes: data.responseTimeMinutes,
      losses: data.losses !== undefined ? normalizeNullable(data.losses) : undefined,
    },
    include: {
      alert: true,
      createdBy: {
        select: PUBLIC_USER_SELECT,
      },
      closedBy: {
        select: PUBLIC_USER_SELECT,
      },
      assignments: {
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

export async function closeIncident(
  incidentId: string,
  actorUserId: string,
  data: { responseTimeMinutes?: number; closingReport: string },
  actorRole?: string,
) {
  const incident = await prisma.incident.findUnique({
    where: { id: incidentId },
  });

  if (!incident) {
    throw new Error("Intervención no encontrada");
  }

  if (incident.status !== "OPEN") {
    throw new Error("Only open incidents can be closed");
  }

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Incident" WHERE "id" = ${incidentId} FOR UPDATE`;
    if (!["ADMIN", "OPERATOR", "GUARD"].includes(actorRole || "")) {
      await requireQrPresence(tx, actorUserId);
    }
    const closedAt = new Date();
    const current = await tx.incident.findUnique({where:{id:incidentId}});
    if(current?.status !== "OPEN") throw new OperationError(409,"La intervencion ya fue cerrada");
    if(current.alertId) await tx.$queryRaw`SELECT "id" FROM "Alert" WHERE "id" = ${current.alertId} FOR UPDATE`;
    if(await tx.missionMovement.findFirst({where:{incidentId,returnedAt:null}}))throw new OperationError(409,"Registre el retorno de todas las dotaciones antes de cerrar la intervencion");
    await finalizeSheet(tx,incidentId,closedAt,actorUserId);

    const updated = await tx.incident.update({
      where: { id: incidentId },
      data: {
        status: "CLOSED",
        closedByUserId: actorUserId,
        closedAt,
        responseTimeMinutes: data.responseTimeMinutes ?? incident.responseTimeMinutes,
        closingReport: data.closingReport,
      },
      include: {
        alert: true,
        createdBy: {
          select: PUBLIC_USER_SELECT,
        },
        closedBy: {
          select: PUBLIC_USER_SELECT,
        },
        assignments: {
          include: {
            user: {
              select: PUBLIC_USER_SELECT,
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
          responseTimeMinutes: updated.responseTimeMinutes,
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

export async function createIncidentUpdate(
  incidentId: string,
  actorUserId: string,
  body: string,
) {
  const incident = await prisma.incident.findUnique({
    where: { id: incidentId },
    include: { assignments: { select: { userId: true } } },
  });
  if (!incident) throw new Error("Intervención no encontrada");
  if (incident.status !== "OPEN") {
    throw new Error("No se pueden agregar novedades a una intervencion cerrada");
  }

  const actor = await prisma.user.findFirst({
    where: { id: actorUserId, deletedAt: null, isActive: true },
    select: { role: true },
  });
  const canWrite =
    actor?.role === "ADMIN" ||
    actor?.role === "OPERATOR" ||
    actor?.role === "GUARD" ||
    incident.createdByUserId === actorUserId ||
    incident.assignments.some((item) => item.userId === actorUserId);
  if (!canWrite) {
    throw new Error("Solo el personal interviniente puede registrar novedades");
  }

  return prisma.$transaction(async (tx) => {
    const update = await tx.incidentUpdate.create({
      data: { incidentId, authorUserId: actorUserId, body },
      include: { author: { select: PUBLIC_USER_SELECT } },
    });
    await tx.auditLog.create({
      data: {
        actorUserId,
        action: "INCIDENT_UPDATE_CREATED",
        entityType: "IncidentUpdate",
        entityId: update.id,
        metadata: { incidentId },
      },
    });
    return update;
  });
}

export async function deleteIncidentUpdate(
  incidentId: string,
  updateId: string,
  actorUserId: string,
) {
  const update = await prisma.incidentUpdate.findFirst({
    where: { id: updateId, incidentId, deletedAt: null },
  });
  if (!update) throw new Error("Novedad no encontrada");

  await prisma.$transaction([
    prisma.incidentUpdate.update({
      where: { id: updateId },
      data: { deletedAt: new Date() },
    }),
    prisma.auditLog.create({
      data: {
        actorUserId,
        action: "INCIDENT_UPDATE_DELETED",
        entityType: "IncidentUpdate",
        entityId: updateId,
        metadata: { incidentId },
      },
    }),
  ]);
  return { message: "Novedad eliminada" };
}

export async function assignUsersToIncident(
  incidentId: string,
  userIds: string[],
  actorUserId?: string,
) {
  const incident = await prisma.incident.findUnique({
    where: { id: incidentId },
  });

  if (!incident) {
    throw new Error("Intervención no encontrada");
  }

  if (incident.status !== "OPEN") {
    throw new Error("Only open incidents can receive assignments");
  }

  const uniqueIds = uniqueUserIds(userIds);

  await ensureUsersExist(uniqueIds);

  const existingAssignments = await prisma.incidentAssignment.findMany({
    where: {
      incidentId,
      userId: { in: uniqueIds },
    },
    select: { userId: true },
  });

  const existingUserIds = new Set(existingAssignments.map((a) => a.userId));
  const newUserIds = uniqueIds.filter((id) => !existingUserIds.has(id));

  if (newUserIds.length > 0) {
    await prisma.incidentAssignment.createMany({
      data: newUserIds.map((userId) => ({
        incidentId,
        userId,
      })),
    });
  }

  await prisma.auditLog.create({
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
