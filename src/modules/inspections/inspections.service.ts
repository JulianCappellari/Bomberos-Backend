import { prisma } from "../../config/prisma";

function normalizeNullable(value?: string | null) {
  if (value === undefined || value === null || value === "") return null;
  return value;
}

function toDateOnly(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

export async function createInspection(data: {
  vehicleId: string;
  incidentType?:
    | "FIRE"
    | "RESCUE"
    | "ACCIDENT"
    | "CHEMICAL"
    | "MEDICAL"
    | "FLOOD"
    | "OTHER";
  inspectionDate: string;
  inspectionTime?: string | null;
  observations?: string | null;
  responsibleUserId: string;
  items: Array<{
    inventoryItemId: string;
    expectedQuantity?: number;
    result: "OK" | "MISSING" | "DAMAGED" | "UNCHECKED";
    observations?: string | null;
  }>;
}) {
  const vehicle = await prisma.vehicle.findUnique({
    where: { id: data.vehicleId },
    include: {
      asset: true,
      inventoryItems: true,
    },
  });

  if (!vehicle) {
    throw new Error("Vehicle not found");
  }

  const inventoryIds = new Set(vehicle.inventoryItems.map((item) => item.id));

  for (const item of data.items) {
    if (!inventoryIds.has(item.inventoryItemId)) {
      throw new Error(`Inventory item ${item.inventoryItemId} does not belong to this vehicle`);
    }
  }

  const summaryOk = data.items.filter((i) => i.result === "OK").length;
  const summaryMissing = data.items.filter((i) => i.result === "MISSING").length;
  const summaryDamaged = data.items.filter((i) => i.result === "DAMAGED").length;
  const summaryUnchecked = data.items.filter((i) => i.result === "UNCHECKED").length;

  const inspection = await prisma.inspection.create({
    data: {
      vehicleId: data.vehicleId,
      incidentType: data.incidentType,
      inspectionDate: toDateOnly(data.inspectionDate),
      inspectionTime: normalizeNullable(data.inspectionTime),
      responsibleUserId: data.responsibleUserId,
      observations: normalizeNullable(data.observations),
      summaryOk,
      summaryMissing,
      summaryDamaged,
      summaryUnchecked,
      items: {
        create: data.items.map((item) => ({
          inventoryItemId: item.inventoryItemId,
          expectedQuantity: item.expectedQuantity || 1,
          result: item.result,
          observations: normalizeNullable(item.observations),
        })),
      },
    },
    include: {
      vehicle: {
        include: {
          asset: true,
        },
      },
      responsible: {
        include: {
          profile: true,
        },
      },
      items: {
        include: {
          inventoryItem: true,
        },
      },
    },
  });

  for (const item of data.items) {
    if (item.result === "DAMAGED" || item.result === "MISSING") {
      await prisma.vehicleInventoryItem.update({
        where: { id: item.inventoryItemId },
        data: {
          state: "REVIEW",
        },
      });
    }

    if (item.result === "OK") {
      await prisma.vehicleInventoryItem.update({
        where: { id: item.inventoryItemId },
        data: {
          state: "OK",
        },
      });
    }
  }

  if (summaryMissing > 0 || summaryDamaged > 0) {
    await prisma.asset.update({
      where: { id: vehicle.assetId },
      data: {
        status: "MAINTENANCE",
      },
    });
  }

  await prisma.auditLog.create({
    data: {
      actorUserId: data.responsibleUserId,
      action: "INSPECTION_CREATED",
      entityType: "Inspection",
      entityId: inspection.id,
      metadata: {
        vehicleId: data.vehicleId,
        summaryOk,
        summaryMissing,
        summaryDamaged,
        summaryUnchecked,
      },
    },
  });

  return inspection;
}

export async function getAllInspections(vehicleId?: string) {
  return prisma.inspection.findMany({
    where: vehicleId ? { vehicleId } : undefined,
    include: {
      vehicle: {
        include: {
          asset: true,
        },
      },
      responsible: {
        include: {
          profile: true,
        },
      },
      items: {
        include: {
          inventoryItem: true,
        },
      },
    },
    orderBy: [
      { inspectionDate: "desc" },
      { createdAt: "desc" },
    ],
  });
}

export async function getInspectionById(inspectionId: string) {
  const inspection = await prisma.inspection.findUnique({
    where: { id: inspectionId },
    include: {
      vehicle: {
        include: {
          asset: true,
        },
      },
      responsible: {
        include: {
          profile: true,
        },
      },
      items: {
        include: {
          inventoryItem: true,
        },
      },
    },
  });

  if (!inspection) {
    throw new Error("Inspection not found");
  }

  return inspection;
}

export async function getVehicleInspectionHistory(vehicleId: string) {
  const vehicle = await prisma.vehicle.findUnique({
    where: { id: vehicleId },
  });

  if (!vehicle) {
    throw new Error("Vehicle not found");
  }

  return prisma.inspection.findMany({
    where: { vehicleId },
    include: {
      vehicle: {
        include: {
          asset: true,
        },
      },
      responsible: {
        include: {
          profile: true,
        },
      },
      items: {
        include: {
          inventoryItem: true,
        },
      },
    },
    orderBy: [
      { inspectionDate: "desc" },
      { createdAt: "desc" },
    ],
  });
}