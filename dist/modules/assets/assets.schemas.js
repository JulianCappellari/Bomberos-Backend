"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.upsertVehicleDataSchema = exports.updateAssetSchema = exports.createAssetSchema = void 0;
const zod_1 = require("zod");
const vehicleSchema = zod_1.z.object({
    unitNumber: zod_1.z.string().min(1).max(20),
    plate: zod_1.z.string().max(20).optional().nullable(),
    year: zod_1.z.number().int().optional(),
    mileage: zod_1.z.number().int().min(0).optional(),
    nextOilChangeMileage: zod_1.z.number().int().min(0).optional(),
});
exports.createAssetSchema = zod_1.z.object({
    name: zod_1.z.string().min(1).max(140),
    assetType: zod_1.z.enum(["VEHICLE", "PPE", "OTHER"]),
    status: zod_1.z.enum(["OPERATIONAL", "MAINTENANCE", "OUT_OF_SERVICE"]).optional(),
    notes: zod_1.z.string().optional().nullable(),
    lastCheckDate: zod_1.z.string().datetime().optional().nullable(),
    vehicle: vehicleSchema.optional(),
});
exports.updateAssetSchema = zod_1.z.object({
    name: zod_1.z.string().min(1).max(140).optional(),
    assetType: zod_1.z.enum(["VEHICLE", "PPE", "OTHER"]).optional(),
    status: zod_1.z.enum(["OPERATIONAL", "MAINTENANCE", "OUT_OF_SERVICE"]).optional(),
    notes: zod_1.z.string().optional().nullable(),
    lastCheckDate: zod_1.z.string().datetime().optional().nullable(),
});
exports.upsertVehicleDataSchema = zod_1.z.object({
    unitNumber: zod_1.z.string().min(1).max(20).optional(),
    plate: zod_1.z.string().max(20).optional().nullable(),
    year: zod_1.z.number().int().optional(),
    mileage: zod_1.z.number().int().min(0).optional(),
    nextOilChangeMileage: zod_1.z.number().int().min(0).optional(),
});
