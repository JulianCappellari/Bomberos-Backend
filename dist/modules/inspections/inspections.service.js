"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createInspection = createInspection;
exports.getAllInspections = getAllInspections;
exports.getInspectionById = getInspectionById;
exports.getVehicleInspectionHistory = getVehicleInspectionHistory;
const prisma_1 = require("../../config/prisma");
function normalizeNullable(value) {
    if (value === undefined || value === null || value === "")
        return null;
    return value;
}
function toDateOnly(value) {
    return new Date(`${value}T00:00:00.000Z`);
}
function inventoryStateForResult(result) {
    if (result === "OK")
        return "OK";
    if (result === "MISSING")
        return "OUT";
    return "REVIEW";
}
function vehicleStatusForInspection(summary) {
    if (summary.summaryMissing > 0 ||
        summary.summaryDamaged > 0 ||
        summary.summaryUnchecked > 0) {
        return "MAINTENANCE";
    }
    return "OPERATIONAL";
}
const inspectionInclude = {
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
};
async function createInspection(data) {
    const vehicle = await prisma_1.prisma.vehicle.findUnique({
        where: { id: data.vehicleId },
        include: {
            asset: true,
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
    const allVehicleItems = vehicle.compartments.flatMap((compartment) => compartment.items);
    const inventoryIds = new Set(allVehicleItems.map((item) => item.id));
    for (const item of data.items) {
        if (!inventoryIds.has(item.inventoryItemId)) {
            throw new Error(`Inventory item ${item.inventoryItemId} does not belong to this vehicle`);
        }
    }
    const responsibleUser = await prisma_1.prisma.user.findFirst({
        where: {
            id: data.responsibleUserId,
            isActive: true,
            isPendingApproval: false,
            deletedAt: null,
        },
        select: { id: true },
    });
    if (!responsibleUser) {
        throw new Error("Responsible user not found or inactive");
    }
    const summaryOk = data.items.filter((i) => i.result === "OK").length;
    const summaryMissing = data.items.filter((i) => i.result === "MISSING").length;
    const summaryDamaged = data.items.filter((i) => i.result === "DAMAGED").length;
    const summaryUnchecked = data.items.filter((i) => i.result === "UNCHECKED").length;
    const inspectionDate = toDateOnly(data.inspectionDate);
    const vehicleStatus = vehicleStatusForInspection({
        summaryMissing,
        summaryDamaged,
        summaryUnchecked,
    });
    const inspection = await prisma_1.prisma.$transaction(async (tx) => {
        const createdInspection = await tx.inspection.create({
            data: {
                vehicleId: data.vehicleId,
                incidentType: data.incidentType,
                inspectionDate,
                inspectionTime: normalizeNullable(data.inspectionTime),
                observations: normalizeNullable(data.observations),
                summaryOk,
                summaryMissing,
                summaryDamaged,
                summaryUnchecked,
            },
        });
        await tx.inspectionResponsible.create({
            data: {
                inspectionId: createdInspection.id,
                userId: data.responsibleUserId,
            },
        });
        for (const item of data.items) {
            const baseItem = await tx.vehicleInventoryItem.findUnique({
                where: { id: item.inventoryItemId },
                select: {
                    expectedQuantity: true,
                },
            });
            if (!baseItem) {
                throw new Error(`Inventory item ${item.inventoryItemId} not found`);
            }
            await tx.inspectionItem.create({
                data: {
                    inspectionId: createdInspection.id,
                    inventoryItemId: item.inventoryItemId,
                    expectedQuantity: item.expectedQuantity ?? baseItem.expectedQuantity,
                    result: item.result,
                    observations: normalizeNullable(item.observations),
                },
            });
        }
        for (const item of data.items) {
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
                actorUserId: data.responsibleUserId,
                action: "INSPECTION_CREATED",
                entityType: "Inspection",
                entityId: createdInspection.id,
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
            where: { id: createdInspection.id },
            include: inspectionInclude,
        });
    });
    return inspection;
}
async function getAllInspections(vehicleId) {
    return prisma_1.prisma.inspection.findMany({
        where: vehicleId ? { vehicleId } : undefined,
        include: inspectionInclude,
        orderBy: [{ inspectionDate: "desc" }, { createdAt: "desc" }],
    });
}
async function getInspectionById(inspectionId) {
    const inspection = await prisma_1.prisma.inspection.findUnique({
        where: { id: inspectionId },
        include: inspectionInclude,
    });
    if (!inspection) {
        throw new Error("Inspection not found");
    }
    return inspection;
}
async function getVehicleInspectionHistory(vehicleId) {
    const vehicle = await prisma_1.prisma.vehicle.findUnique({
        where: { id: vehicleId },
    });
    if (!vehicle) {
        throw new Error("Vehicle not found");
    }
    return prisma_1.prisma.inspection.findMany({
        where: { vehicleId },
        include: inspectionInclude,
        orderBy: [{ inspectionDate: "desc" }, { createdAt: "desc" }],
    });
}
