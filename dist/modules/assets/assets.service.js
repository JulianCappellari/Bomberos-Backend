"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createAsset = createAsset;
exports.getAllAssets = getAllAssets;
exports.getAssetById = getAssetById;
exports.updateAsset = updateAsset;
exports.deleteAsset = deleteAsset;
exports.upsertVehicleData = upsertVehicleData;
const prisma_1 = require("../../config/prisma");
function normalizeNullable(value) {
    if (value === undefined || value === null || value === "")
        return null;
    return value;
}
function toDateOrNull(value) {
    if (!value)
        return null;
    return new Date(value);
}
async function createAsset(data) {
    if (data.assetType === "VEHICLE" && !data.vehicle?.unitNumber) {
        throw new Error("unitNumber is required for vehicle assets");
    }
    if (data.vehicle?.plate) {
        const existingVehicle = await prisma_1.prisma.vehicle.findFirst({
            where: { plate: data.vehicle.plate },
        });
        if (existingVehicle) {
            throw new Error("Vehicle plate already exists");
        }
    }
    if (data.assetType === "VEHICLE" && data.vehicle?.unitNumber) {
        const existingUnitNumber = await prisma_1.prisma.vehicle.findFirst({
            where: { unitNumber: data.vehicle.unitNumber },
        });
        if (existingUnitNumber) {
            throw new Error("Vehicle unit number already exists");
        }
    }
    const asset = await prisma_1.prisma.asset.create({
        data: {
            name: data.name,
            assetType: data.assetType,
            status: data.status || "OPERATIONAL",
            notes: normalizeNullable(data.notes),
            lastCheckDate: toDateOrNull(data.lastCheckDate),
            vehicle: data.assetType === "VEHICLE"
                ? {
                    create: {
                        unitNumber: data.vehicle.unitNumber,
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
    await prisma_1.prisma.auditLog.create({
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
async function getAllAssets(assetType, status) {
    return prisma_1.prisma.asset.findMany({
        where: {
            deletedAt: null,
            ...(assetType
                ? {
                    assetType: assetType,
                }
                : {}),
            ...(status
                ? {
                    status: status,
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
async function getAssetById(assetId) {
    const asset = await prisma_1.prisma.asset.findFirst({
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
async function updateAsset(assetId, data, actorUserId) {
    const existing = await prisma_1.prisma.asset.findFirst({
        where: {
            id: assetId,
            deletedAt: null,
        },
    });
    if (!existing) {
        throw new Error("Asset not found");
    }
    const updated = await prisma_1.prisma.asset.update({
        where: { id: assetId },
        data: {
            name: data.name,
            assetType: data.assetType,
            status: data.status,
            notes: data.notes !== undefined ? normalizeNullable(data.notes) : undefined,
            lastCheckDate: data.lastCheckDate !== undefined
                ? toDateOrNull(data.lastCheckDate)
                : undefined,
        },
        include: {
            vehicle: true,
        },
    });
    await prisma_1.prisma.auditLog.create({
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
async function deleteAsset(assetId, actorUserId) {
    const existing = await prisma_1.prisma.asset.findFirst({
        where: {
            id: assetId,
            deletedAt: null,
        },
    });
    if (!existing) {
        throw new Error("Asset not found");
    }
    await prisma_1.prisma.asset.update({
        where: { id: assetId },
        data: {
            deletedAt: new Date(),
        },
    });
    await prisma_1.prisma.auditLog.create({
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
async function upsertVehicleData(assetId, data, actorUserId) {
    const asset = await prisma_1.prisma.asset.findFirst({
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
        const existingPlate = await prisma_1.prisma.vehicle.findFirst({
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
        const existingUnitNumber = await prisma_1.prisma.vehicle.findFirst({
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
        ? await prisma_1.prisma.vehicle.update({
            where: { assetId },
            data: {
                unitNumber: data.unitNumber,
                plate: normalizeNullable(data.plate),
                year: data.year,
                mileage: data.mileage,
                nextOilChangeMileage: data.nextOilChangeMileage,
            },
        })
        : await prisma_1.prisma.vehicle.create({
            data: {
                assetId,
                unitNumber: data.unitNumber,
                plate: normalizeNullable(data.plate),
                year: data.year,
                mileage: data.mileage,
                nextOilChangeMileage: data.nextOilChangeMileage,
            },
        });
    await prisma_1.prisma.auditLog.create({
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
