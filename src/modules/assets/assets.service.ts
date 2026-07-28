import { prisma } from "../../config/prisma";

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
    unitNumber: string;
    plate?: string | null;
    year?: number;
    mileage?: number;
    nextOilChangeMileage?: number;
  };
  actorUserId?: string;
}) {
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
) {
  const existing = await prisma.asset.findFirst({
    where: {
      id: assetId,
      deletedAt: null,
    },
  });

  if (!existing) {
    throw new Error("Asset not found");
  }

  const updated = await prisma.asset.update({
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

  await prisma.auditLog.create({
    data: {
      actorUserId: actorUserId || null,
      action: "ASSET_UPDATED",
      entityType: "Asset",
      entityId: updated.id,
      metadata: {
        name: updated.name,
        assetType: updated.assetType,
      },
    },
  });

  return updated;
}

export async function deleteAsset(assetId: string, actorUserId?: string) {
  const existing = await prisma.asset.findFirst({
    where: {
      id: assetId,
      deletedAt: null,
    },
  });

  if (!existing) {
    throw new Error("Asset not found");
  }

  await prisma.asset.update({
    where: { id: assetId },
    data: {
      deletedAt: new Date(),
    },
  });

  await prisma.auditLog.create({
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
}

export async function upsertVehicleData(
  assetId: string,
  data: {
    unitNumber?: string;
    plate?: string | null;
    year?: number;
    mileage?: number;
    nextOilChangeMileage?: number;
  },
  actorUserId?: string,
) {
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
          plate: normalizeNullable(data.plate),
          year: data.year,
          mileage: data.mileage,
          nextOilChangeMileage: data.nextOilChangeMileage,
        },
      })
    : await prisma.vehicle.create({
        data: {
          assetId,
          unitNumber: data.unitNumber!,
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
}