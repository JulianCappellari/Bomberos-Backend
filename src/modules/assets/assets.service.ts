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
    plate?: string | null;
    year?: number;
    mileage?: number;
    nextOilChangeMileage?: number;
  };
  actorUserId?: string;
}) {
  if (data.vehicle?.plate) {
    const existingVehicle = await prisma.vehicle.findFirst({
      where: { plate: data.vehicle.plate },
    });

    if (existingVehicle) {
      throw new Error("Vehicle plate already exists");
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
                plate: normalizeNullable(data.vehicle?.plate),
                year: data.vehicle?.year,
                mileage: data.vehicle?.mileage,
                nextOilChangeMileage: data.vehicle?.nextOilChangeMileage,
              },
            }
          : undefined,
    },
    include: {
      vehicle: {
        include: {
          inventoryItems: true,
          inspections: true,
        },
      },
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
      vehicle: {
        include: {
          inventoryItems: true,
          inspections: true,
        },
      },
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
      vehicle: {
        include: {
          inventoryItems: true,
          inspections: {
            include: {
              responsible: {
                include: {
                  profile: true,
                },
              },
            },
            orderBy: {
              inspectionDate: "desc",
            },
          },
        },
      },
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
      notes: data.notes !== undefined ? normalizeNullable(data.notes) : undefined,
      lastCheckDate:
        data.lastCheckDate !== undefined
          ? toDateOrNull(data.lastCheckDate)
          : undefined,
    },
    include: {
      vehicle: {
        include: {
          inventoryItems: true,
          inspections: true,
        },
      },
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

  const vehicle = asset.vehicle
    ? await prisma.vehicle.update({
        where: { assetId },
        data: {
          plate: normalizeNullable(data.plate),
          year: data.year,
          mileage: data.mileage,
          nextOilChangeMileage: data.nextOilChangeMileage,
        },
        include: {
          inventoryItems: true,
          inspections: true,
        },
      })
    : await prisma.vehicle.create({
        data: {
          assetId,
          plate: normalizeNullable(data.plate),
          year: data.year,
          mileage: data.mileage,
          nextOilChangeMileage: data.nextOilChangeMileage,
        },
        include: {
          inventoryItems: true,
          inspections: true,
        },
      });

  await prisma.auditLog.create({
    data: {
      actorUserId: actorUserId || null,
      action: "VEHICLE_UPSERTED",
      entityType: "Vehicle",
      entityId: vehicle.id,
      metadata: {
        plate: vehicle.plate,
        year: vehicle.year,
      },
    },
  });

  return vehicle;
}

export async function createVehicleInventoryItem(
  vehicleId: string,
  data: {
    name: string;
    quantity?: number;
    state?: "OK" | "REVIEW" | "OUT";
    compartment?: string | null;
    notes?: string | null;
  },
  actorUserId?: string,
) {
  const vehicle = await prisma.vehicle.findUnique({
    where: { id: vehicleId },
  });

  if (!vehicle) {
    throw new Error("Vehicle not found");
  }

  const item = await prisma.vehicleInventoryItem.create({
    data: {
      vehicleId,
      name: data.name,
      quantity: data.quantity || 1,
      state: data.state || "OK",
      compartment: normalizeNullable(data.compartment),
      notes: normalizeNullable(data.notes),
    },
  });

  await prisma.auditLog.create({
    data: {
      actorUserId: actorUserId || null,
      action: "VEHICLE_INVENTORY_ITEM_CREATED",
      entityType: "VehicleInventoryItem",
      entityId: item.id,
      metadata: {
        vehicleId,
        name: item.name,
        quantity: item.quantity,
      },
    },
  });

  return item;
}

export async function updateVehicleInventoryItem(
  itemId: string,
  data: {
    name?: string;
    quantity?: number;
    state?: "OK" | "REVIEW" | "OUT";
    compartment?: string | null;
    notes?: string | null;
  },
  actorUserId?: string,
) {
  const existing = await prisma.vehicleInventoryItem.findUnique({
    where: { id: itemId },
  });

  if (!existing) {
    throw new Error("Vehicle inventory item not found");
  }

  const updated = await prisma.vehicleInventoryItem.update({
    where: { id: itemId },
    data: {
      name: data.name,
      quantity: data.quantity,
      state: data.state,
      compartment:
        data.compartment !== undefined ? normalizeNullable(data.compartment) : undefined,
      notes: data.notes !== undefined ? normalizeNullable(data.notes) : undefined,
    },
  });

  await prisma.auditLog.create({
    data: {
      actorUserId: actorUserId || null,
      action: "VEHICLE_INVENTORY_ITEM_UPDATED",
      entityType: "VehicleInventoryItem",
      entityId: updated.id,
      metadata: {
        vehicleId: updated.vehicleId,
        name: updated.name,
        quantity: updated.quantity,
      },
    },
  });

  return updated;
}

export async function deleteVehicleInventoryItem(itemId: string, actorUserId?: string) {
  const existing = await prisma.vehicleInventoryItem.findUnique({
    where: { id: itemId },
  });

  if (!existing) {
    throw new Error("Vehicle inventory item not found");
  }

  await prisma.vehicleInventoryItem.delete({
    where: { id: itemId },
  });

  await prisma.auditLog.create({
    data: {
      actorUserId: actorUserId || null,
      action: "VEHICLE_INVENTORY_ITEM_DELETED",
      entityType: "VehicleInventoryItem",
      entityId: itemId,
      metadata: {
        vehicleId: existing.vehicleId,
        name: existing.name,
      },
    },
  });

  return { message: "Vehicle inventory item deleted successfully" };
}