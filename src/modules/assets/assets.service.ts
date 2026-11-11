import { notifyCommand } from "../members/notifications.service";
import { prisma } from "../../config/prisma";
import { serializable } from "../../utils/transaction";
import { inspectionTimestamp } from "../inspections/inspections.rules";

function normalizeNullable(value?: string | null) {
  if (value === undefined || value === null || value === "") return null;
  return value;
}

function toDateOrNull(value?: string | null) {
  if (!value) return null;
  return new Date(value);
}

export async function createAsset(data: {
  name: string;
  assetType: "VEHICLE" | "PPE" | "OTHER";
  status?: "OPERATIONAL" | "MAINTENANCE" | "OUT_OF_SERVICE";
  notes?: string | null;
  lastCheckDate?: string | null;
  vehicle?: {
    kind?: string;
    licenseCategory?: string;
    unitNumber: string;
    plate?: string | null;
    year?: number;
    mileage?: number;
    nextOilChangeMileage?: number;
  };
  actorUserId?: string;
}) {
  return serializable(async (prisma) => {
  if (data.assetType === "VEHICLE" && !data.vehicle?.unitNumber) {
    throw new Error("unitNumber is required for vehicle assets");
  }

  if (data.vehicle?.plate) {
    const existingVehicle = await prisma.vehicle.findFirst({
      where: { plate: data.vehicle.plate },
    });

    if (existingVehicle) {
      throw new Error("Vehicle plate already exists");
    }
  }

  if (data.assetType === "VEHICLE" && data.vehicle?.unitNumber) {
    const existingUnitNumber = await prisma.vehicle.findFirst({
      where: { unitNumber: data.vehicle.unitNumber },
    });

    if (existingUnitNumber) {
      throw new Error("Vehicle unit number already exists");
    }
  }

  const asset = await prisma.asset.create({
    data: {
      name: data.name,
      assetType: data.assetType,
      status: data.status || "OPERATIONAL",
      notes: normalizeNullable(data.notes),
      lastCheckDate: toDateOrNull(data.lastCheckDate),
      vehicle:
        data.assetType === "VEHICLE"
          ? {
              create: {
                unitNumber: data.vehicle!.unitNumber,
                kind: data.vehicle?.kind || "UNCLASSIFIED",
                licenseCategory: data.vehicle?.licenseCategory || "UNSET",
                plate: normalizeNullable(data.vehicle?.plate),
                year: data.vehicle?.year,
                mileage: data.vehicle?.mileage,
                nextOilChangeMileage: data.vehicle?.nextOilChangeMileage,
              },
            }
          : undefined,
    },
    include: {
      vehicle: true,
    },
  });

  await prisma.auditLog.create({
    data: {
      actorUserId: data.actorUserId || null,
      action: "ASSET_CREATED",
      entityType: "Asset",
      entityId: asset.id,
      metadata: {
        name: asset.name,
        assetType: asset.assetType,
      },
    },
  });

  return asset;
  });
}

export async function getAllAssets(assetType?: string, status?: string) {
  return prisma.asset.findMany({
    where: {
      deletedAt: null,
      ...(assetType
        ? {
            assetType: assetType as "VEHICLE" | "PPE" | "OTHER",
          }
        : {}),
      ...(status
        ? {
            status: status as "OPERATIONAL" | "MAINTENANCE" | "OUT_OF_SERVICE",
          }
        : {}),
    },
    include: {
      vehicle: true,
    },
    orderBy: {
      createdAt: "desc",
    },
  });
}

export async function getAssetById(assetId: string) {
  const asset = await prisma.asset.findFirst({
    where: {
      id: assetId,
      deletedAt: null,
    },
    include: {
      vehicle: true,
    },
  });

  if (!asset) {
    throw new Error("Asset not found");
  }

  return asset;
}

export async function updateAsset(
  assetId: string,
  data: {
    name?: string;
    assetType?: "VEHICLE" | "PPE" | "OTHER";
    status?: "OPERATIONAL" | "MAINTENANCE" | "OUT_OF_SERVICE";
    notes?: string | null;
    lastCheckDate?: string | null;
  },
  actorUserId?: string,
  access: { fleetManager: boolean; command: boolean } = { fleetManager: true, command: true },
) {
  return serializable(async (tx) => {
  const existing = await tx.asset.findFirst({
    where: {
      id: assetId,
      deletedAt: null,
    },
  });

  if (!existing) {
    throw new Error("Asset not found");
  }
  const statusChanged = data.status !== undefined && data.status !== existing.status;
  // I09: el estado operativo lo cambia el responsable de flota designado. Jefatura conserva
  // unicamente la posibilidad de restringir (pasar a mantenimiento o fuera de servicio).
  if (!access.command && (!access.fleetManager || Object.keys(data).some((key) => key !== "status" && (data as Record<string, unknown>)[key] !== undefined))) throw new Error("El responsable de flota solo puede cambiar el estado operativo");
  if (statusChanged && existing.assetType === "VEHICLE" && !access.fleetManager) {
    const order = { OPERATIONAL: 0, MAINTENANCE: 1, OUT_OF_SERVICE: 2 } as const;
    if (order[data.status!] < order[existing.status]) throw new Error("Solo el responsable de flota designado puede rehabilitar un móvil");
  }

  if (await tx.personalEquipment.findUnique({ where: { assetId }, select: { id: true } })) {
    throw new Error("Use Equipamiento personal para modificar o revisar este elemento");
  }
  if (await tx.airCylinder.findUnique({ where: { assetId }, select: { id: true } }) || await tx.airCompressor.findUnique({ where: { assetId }, select: { id: true } })) throw new Error("Use ERA y compresor para revisar este equipo");
  if (data.assetType && data.assetType !== existing.assetType) {
    throw new Error("No se puede cambiar el tipo de un activo ya registrado");
  }

  if (data.status === "OPERATIONAL") {
    const blockingJob = await tx.maintenanceJob.findFirst({
      where: { assetId, blocksOperation: true, status: { in: ["OPEN", "IN_PROGRESS"] } },
      select: { id: true },
    });
    if (blockingJob) throw new Error("Hay mantenimiento bloqueante pendiente. No se puede declarar operativo.");
    if (existing.assetType === "VEHICLE") {
      const vehicle = await tx.vehicle.findUnique({
        where: { assetId },
        include: { inspections: { where: { voidedAt: null }, take: 1, orderBy: [{ inspectionDate: "desc" }, { inspectionTime: "desc" }, { createdAt: "desc" }] } },
      });
      const inspection = vehicle?.inspections[0];
      if (!inspection || inspection.summaryMissing || inspection.summaryDamaged || inspection.summaryUnchecked) {
        throw new Error("Se requiere un control vehicular completo y sin novedades para declarar operativo.");
      }
      const checkedAt = inspectionTimestamp(inspection.inspectionDate.toISOString().slice(0, 10), inspection.inspectionTime || "00:00");
      if (Date.now() - checkedAt > 7 * 86400000) throw new Error("El control vehicular esta vencido. Realice un nuevo control.");
      const closedJob = await tx.maintenanceJob.findFirst({
        where: { assetId, blocksOperation: true, resolvedAt: { not: null } },
        orderBy: { resolvedAt: "desc" }, select: { resolvedAt: true },
      });
      if (closedJob?.resolvedAt && Math.floor(checkedAt / 60000) < Math.floor(closedJob.resolvedAt.getTime() / 60000)) {
        throw new Error("Se requiere un control posterior al cierre del mantenimiento.");
      }
    }
  }

  const updated = await tx.asset.update({
    where: { id: assetId },
    data: {
      name: data.name,
      assetType: data.assetType,
      status: data.status,
      notes:
        data.notes !== undefined ? normalizeNullable(data.notes) : undefined,
      lastCheckDate:
        data.lastCheckDate !== undefined
          ? toDateOrNull(data.lastCheckDate)
          : undefined,
    },
    include: {
      vehicle: true,
    },
  });

  await tx.auditLog.create({
    data: {
      actorUserId: actorUserId || null,
      action: "ASSET_UPDATED",
      entityType: "Asset",
      entityId: updated.id,
      metadata: {
        name: updated.name,
        assetType: updated.assetType,
        ...(statusChanged ? { previousStatus: existing.status, status: updated.status } : {}),
      },
    },
  });
  // F13: un movil que deja de estar operativo se informa siempre a jefatura.
  if (statusChanged && existing.assetType === "VEHICLE" && updated.status !== "OPERATIONAL") await notifyCommand(tx, `${updated.name}: ${updated.status === "OUT_OF_SERVICE" ? "fuera de servicio" : "en mantenimiento"}`, "/equipment", undefined, actorUserId);

  return updated;
  });
}

export async function deleteAsset(assetId: string, actorUserId?: string) {
  return serializable(async (tx) => {
  const existing = await tx.asset.findFirst({
    where: {
      id: assetId,
      deletedAt: null,
    },
  });

  if (!existing) {
    throw new Error("Asset not found");
  }
  if (await tx.personalEquipment.findUnique({ where: { assetId }, select: { id: true } })) throw new Error("Use la baja de Equipamiento personal para conservar su historial");
  if (await tx.airCylinder.findUnique({ where: { assetId }, select: { id: true } }) || await tx.airCompressor.findUnique({ where: { assetId }, select: { id: true } })) throw new Error("Use la baja de ERA y compresor para conservar el historial");
  if (await tx.airCylinder.count({ where: { vehicleAssetId: assetId, retiredAt: null } })) throw new Error("Reubique los cilindros ERA antes de eliminar el movil");

  await tx.asset.update({
    where: { id: assetId },
    data: {
      deletedAt: new Date(),
    },
  });

  await tx.auditLog.create({
    data: {
      actorUserId: actorUserId || null,
      action: "ASSET_DELETED",
      entityType: "Asset",
      entityId: assetId,
      metadata: {
        name: existing.name,
        assetType: existing.assetType,
      },
    },
  });

  return { message: "Asset deleted successfully" };
  });
}

export async function upsertVehicleData(
  assetId: string,
  data: {
    kind?: string;
    licenseCategory?: string;
    unitNumber?: string;
    plate?: string | null;
    year?: number;
    mileage?: number;
    nextOilChangeMileage?: number;
  },
  actorUserId?: string,
) {
  return serializable(async (prisma) => {
  const asset = await prisma.asset.findFirst({
    where: {
      id: assetId,
      deletedAt: null,
    },
    include: {
      vehicle: true,
    },
  });

  if (!asset) {
    throw new Error("Asset not found");
  }

  if (asset.assetType !== "VEHICLE") {
    throw new Error("Asset is not a vehicle");
  }

  if (data.plate) {
    const existingPlate = await prisma.vehicle.findFirst({
      where: {
        plate: data.plate,
        NOT: {
          assetId,
        },
      },
    });

    if (existingPlate) {
      throw new Error("Vehicle plate already exists");
    }
  }

  if (data.unitNumber) {
    const existingUnitNumber = await prisma.vehicle.findFirst({
      where: {
        unitNumber: data.unitNumber,
        NOT: {
          assetId,
        },
      },
    });

    if (existingUnitNumber) {
      throw new Error("Vehicle unit number already exists");
    }
  }

  if (!asset.vehicle && !data.unitNumber) {
    throw new Error("unitNumber is required to create vehicle data");
  }

  const vehicle = asset.vehicle
    ? await prisma.vehicle.update({
        where: { assetId },
        data: {
          unitNumber: data.unitNumber,
          kind: data.kind,
          licenseCategory: data.licenseCategory,
          plate: data.plate === undefined ? undefined : normalizeNullable(data.plate),
          year: data.year,
          mileage: data.mileage,
          nextOilChangeMileage: data.nextOilChangeMileage,
        },
      })
    : await prisma.vehicle.create({
        data: {
          assetId,
          unitNumber: data.unitNumber!,
          kind: data.kind || "UNCLASSIFIED",
          licenseCategory: data.licenseCategory || "UNSET",
          plate: normalizeNullable(data.plate),
          year: data.year,
          mileage: data.mileage,
          nextOilChangeMileage: data.nextOilChangeMileage,
        },
      });

  await prisma.auditLog.create({
    data: {
      actorUserId: actorUserId || null,
      action: "VEHICLE_UPSERTED",
      entityType: "Vehicle",
      entityId: vehicle.id,
      metadata: {
        unitNumber: vehicle.unitNumber,
        plate: vehicle.plate,
        year: vehicle.year,
      },
    },
  });

  return vehicle;
  });
}
