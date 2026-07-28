import { prisma } from "../../config/prisma";

function normalizeNullable(value?: string | null) {
  if (value === undefined || value === null || value === "") return null;
  return value;
}

function inventoryStateForResult(
  result: "OK" | "MISSING" | "DAMAGED" | "UNCHECKED",
) {
  if (result === "OK") return "OK";
  if (result === "MISSING") return "OUT";
  return "REVIEW";
}

function vehicleStatusForInspection(summary: {
  summaryMissing: number;
  summaryDamaged: number;
  summaryUnchecked: number;
}) {
  if (
    summary.summaryMissing > 0 ||
    summary.summaryDamaged > 0 ||
    summary.summaryUnchecked > 0
  ) {
    return "MAINTENANCE";
  }

  return "OPERATIONAL";
}

export async function createCompartment(
  vehicleId: string,
  data: {
    name: string;
    description?: string | null;
    sortOrder?: number;
  },
  actorUserId?: string,
) {
  const vehicle = await prisma.vehicle.findUnique({
    where: { id: vehicleId },
  });

  if (!vehicle) {
    throw new Error("Vehicle not found");
  }

  const existingCompartment = await prisma.vehicleCompartment.findFirst({
    where: {
      vehicleId,
      name: data.name,
    },
  });

  if (existingCompartment) {
    throw new Error("Ya existe un compartimento con ese nombre en este camión");
  }

  const compartment = await prisma.vehicleCompartment.create({
    data: {
      vehicleId,
      name: data.name,
      description: normalizeNullable(data.description),
      sortOrder: data.sortOrder ?? 0,
    },
  });

  await prisma.auditLog.create({
    data: {
      actorUserId: actorUserId || null,
      action: "VEHICLE_COMPARTMENT_CREATED",
      entityType: "VehicleCompartment",
      entityId: compartment.id,
      metadata: {
        vehicleId,
        name: compartment.name,
      },
    },
  });

  return compartment;
}

export async function createInventoryItem(
  compartmentId: string,
  data: {
    name: string;
    expectedQuantity: number;
    state?: "OK" | "REVIEW" | "OUT";
    notes?: string | null;
  },
  actorUserId?: string,
) {
  const compartment = await prisma.vehicleCompartment.findUnique({
    where: { id: compartmentId },
    include: {
      vehicle: true,
    },
  });

  if (!compartment) {
    throw new Error("Compartment not found");
  }

  const existingItem = await prisma.vehicleInventoryItem.findFirst({
    where: {
      compartmentId,
      name: data.name,
    },
    select: {
      id: true,
    },
  });

  if (existingItem) {
    throw new Error("Ya existe un item con ese nombre en este compartimento");
  }

  const item = await prisma.vehicleInventoryItem.create({
    data: {
      compartmentId,
      name: data.name,
      expectedQuantity: data.expectedQuantity,
      state: data.state ?? "OK",
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
        vehicleId: compartment.vehicleId,
        compartmentId,
        name: item.name,
        expectedQuantity: item.expectedQuantity,
        state: item.state,
      },
    },
  });

  return item;
}

export async function updateInventoryItem(
  itemId: string,
  data: {
    compartmentId?: string;
    name?: string;
    expectedQuantity?: number;
    state?: "OK" | "REVIEW" | "OUT";
    notes?: string | null;
  },
  actorUserId?: string,
) {
  const existingItem = await prisma.vehicleInventoryItem.findUnique({
    where: { id: itemId },
    include: {
      compartment: {
        include: {
          vehicle: true,
        },
      },
    },
  });

  if (!existingItem) {
    throw new Error("Inventory item not found");
  }

  if (data.compartmentId && data.compartmentId !== existingItem.compartmentId) {
    const targetCompartment = await prisma.vehicleCompartment.findUnique({
      where: { id: data.compartmentId },
      select: {
        id: true,
        vehicleId: true,
      },
    });

    if (!targetCompartment) {
      throw new Error("Target compartment not found");
    }

    if (targetCompartment.vehicleId !== existingItem.compartment.vehicleId) {
      throw new Error("No se puede mover un ítem a otro vehículo");
    }
  }

  const targetCompartmentId = data.compartmentId ?? existingItem.compartmentId;
  const targetName = data.name ?? existingItem.name;

  if (
    targetCompartmentId !== existingItem.compartmentId ||
    targetName !== existingItem.name
  ) {
    const duplicateItem = await prisma.vehicleInventoryItem.findFirst({
      where: {
        id: {
          not: itemId,
        },
        compartmentId: targetCompartmentId,
        name: targetName,
      },
      select: {
        id: true,
      },
    });

    if (duplicateItem) {
      throw new Error("Ya existe un item con ese nombre en este compartimento");
    }
  }

  const updatedItem = await prisma.vehicleInventoryItem.update({
    where: { id: itemId },
    data: {
      compartmentId: data.compartmentId,
      name: data.name,
      expectedQuantity: data.expectedQuantity,
      state: data.state,
      notes: data.notes !== undefined ? normalizeNullable(data.notes) : undefined,
    },
  });

  await prisma.auditLog.create({
    data: {
      actorUserId: actorUserId || null,
      action: "VEHICLE_INVENTORY_ITEM_UPDATED",
      entityType: "VehicleInventoryItem",
      entityId: updatedItem.id,
      metadata: {
        vehicleId: existingItem.compartment.vehicleId,
        before: {
          compartmentId: existingItem.compartmentId,
          name: existingItem.name,
          expectedQuantity: existingItem.expectedQuantity,
          state: existingItem.state,
          notes: existingItem.notes,
        },
        after: {
          compartmentId: updatedItem.compartmentId,
          name: updatedItem.name,
          expectedQuantity: updatedItem.expectedQuantity,
          state: updatedItem.state,
          notes: updatedItem.notes,
        },
      },
    },
  });

  return updatedItem;
}

export async function deleteInventoryItem(
  itemId: string,
  actorUserId?: string,
) {
  const existingItem = await prisma.vehicleInventoryItem.findUnique({
    where: { id: itemId },
    include: {
      compartment: true,
      inspectionItems: {
        select: {
          id: true,
        },
        take: 1,
      },
    },
  });

  if (!existingItem) {
    throw new Error("Inventory item not found");
  }

  if (existingItem.inspectionItems.length > 0) {
    throw new Error(
      "No se puede eliminar un ítem con historial de inspecciones. Marcá el estado como Fuera.",
    );
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
        vehicleId: existingItem.compartment.vehicleId,
        compartmentId: existingItem.compartmentId,
        name: existingItem.name,
        expectedQuantity: existingItem.expectedQuantity,
        state: existingItem.state,
      },
    },
  });

  return {
    message: "Ítem eliminado correctamente",
  };
}

export async function getVehicleInventory(vehicleId: string) {
  const vehicle = await prisma.vehicle.findUnique({
    where: { id: vehicleId },
    include: {
      asset: true,
      compartments: {
        orderBy: {
          sortOrder: "asc",
        },
        include: {
          items: {
            orderBy: {
              name: "asc",
            },
          },
        },
      },
    },
  });

  if (!vehicle) {
    throw new Error("Vehicle not found");
  }

  return vehicle;
}

export async function createInspection(data: {
  vehicleId: string;
  incidentType?: "FIRE" | "RESCUE" | "ACCIDENT" | "CHEMICAL" | "MEDICAL" | "FLOOD" | "OTHER" | null;
  inspectionDate?: string;
  inspectionTime?: string | null;
  observations?: string | null;
  actorUserId?: string;
  responsibleUserIds: string[];
  items: {
    inventoryItemId: string;
    result: "OK" | "MISSING" | "DAMAGED" | "UNCHECKED";
    observations?: string | null;
  }[];
}) {
  const vehicle = await prisma.vehicle.findUnique({
    where: { id: data.vehicleId },
    include: {
      compartments: {
        include: {
          items: true,
        },
      },
    },
  });

  if (!vehicle) {
    throw new Error("Vehicle not found");
  }

  const allVehicleItemIds = vehicle.compartments.flatMap((compartment) =>
    compartment.items.map((item) => item.id),
  );

  const invalidItem = data.items.find(
    (item) => !allVehicleItemIds.includes(item.inventoryItemId),
  );

  if (invalidItem) {
    throw new Error("Hay herramientas que no pertenecen a este camión");
  }

  const responsibleUserIds = Array.from(new Set(data.responsibleUserIds));

  if (responsibleUserIds.length !== data.responsibleUserIds.length) {
    throw new Error("No se puede repetir el mismo responsable en un control");
  }

  const users = await prisma.user.findMany({
    where: {
      id: { in: responsibleUserIds },
      deletedAt: null,
      isActive: true,
      isPendingApproval: false,
    },
    select: {
      id: true,
    },
  });

  if (users.length !== responsibleUserIds.length) {
    throw new Error("Uno o más bomberos responsables no son válidos");
  }

  const summaryOk = data.items.filter((item) => item.result === "OK").length;
  const summaryMissing = data.items.filter((item) => item.result === "MISSING").length;
  const summaryDamaged = data.items.filter((item) => item.result === "DAMAGED").length;
  const summaryUnchecked = data.items.filter((item) => item.result === "UNCHECKED").length;

  const inspectionDate = data.inspectionDate
    ? new Date(data.inspectionDate)
    : new Date();
  const vehicleStatus = vehicleStatusForInspection({
    summaryMissing,
    summaryDamaged,
    summaryUnchecked,
  });

  return prisma.$transaction(async (tx) => {
    const inspection = await tx.inspection.create({
      data: {
        vehicleId: data.vehicleId,
        incidentType: data.incidentType ?? null,
        inspectionDate,
        inspectionTime: normalizeNullable(data.inspectionTime),
        observations: normalizeNullable(data.observations),
        summaryOk,
        summaryMissing,
        summaryDamaged,
        summaryUnchecked,
      },
    });

    await tx.inspectionResponsible.createMany({
      data: responsibleUserIds.map((userId) => ({
        inspectionId: inspection.id,
        userId,
      })),
    });

    for (const item of data.items) {
      const baseItem = await tx.vehicleInventoryItem.findUnique({
        where: { id: item.inventoryItemId },
        select: {
          expectedQuantity: true,
        },
      });

      if (!baseItem) {
        throw new Error("Inventory item not found");
      }

      await tx.inspectionItem.create({
        data: {
          inspectionId: inspection.id,
          inventoryItemId: item.inventoryItemId,
          expectedQuantity: baseItem.expectedQuantity,
          result: item.result,
          observations: normalizeNullable(item.observations),
        },
      });

      await tx.vehicleInventoryItem.update({
        where: { id: item.inventoryItemId },
        data: {
          state: inventoryStateForResult(item.result),
        },
      });
    }

    await tx.asset.update({
      where: { id: vehicle.assetId },
      data: {
        status: vehicleStatus,
        lastCheckDate: inspectionDate,
      },
    });

    await tx.auditLog.create({
      data: {
        actorUserId: data.actorUserId || responsibleUserIds[0] || null,
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

    return tx.inspection.findUnique({
      where: { id: inspection.id },
      include: {
        vehicle: {
          include: {
            asset: true,
          },
        },
        responsibles: {
          include: {
            user: {
              include: {
                profile: true,
              },
            },
          },
        },
        items: {
          include: {
            inventoryItem: {
              include: {
                compartment: true,
              },
            },
          },
        },
      },
    });
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
      responsibles: {
        include: {
          user: {
            include: {
              profile: true,
            },
          },
        },
      },
      items: {
        include: {
          inventoryItem: {
            include: {
              compartment: true,
            },
          },
        },
      },
    },
  });

  if (!inspection) {
    throw new Error("Inspection not found");
  }

  return inspection;
}

export async function getVehicleInspections(vehicleId: string) {
  const vehicle = await prisma.vehicle.findUnique({
    where: { id: vehicleId },
  });

  if (!vehicle) {
    throw new Error("Vehicle not found");
  }

  return prisma.inspection.findMany({
    where: {
      vehicleId,
    },
    include: {
      responsibles: {
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
      inspectionDate: "desc",
    },
  });
}
