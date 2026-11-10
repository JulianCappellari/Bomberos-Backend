import { z } from "zod";

const vehicleSchema = z.object({
  kind: z.enum(["UNCLASSIFIED", "ENGINE", "TANKER", "RESCUE", "AMBULANCE", "SUPPORT", "OTHER"]).optional(),
  unitNumber: z.string().min(1).max(20),
  plate: z.string().max(20).optional().nullable(),
  year: z.number().int().optional(),
  mileage: z.number().int().min(0).optional(),
  nextOilChangeMileage: z.number().int().min(0).optional(),
});

export const createAssetSchema = z.object({
  name: z.string().min(1).max(140),
  assetType: z.enum(["VEHICLE", "PPE", "OTHER"]),
  status: z.enum(["OPERATIONAL", "MAINTENANCE", "OUT_OF_SERVICE"]).optional(),
  notes: z.string().optional().nullable(),
  lastCheckDate: z.string().datetime().optional().nullable(),
  vehicle: vehicleSchema.optional(),
});

export const updateAssetSchema = z.object({
  name: z.string().min(1).max(140).optional(),
  assetType: z.enum(["VEHICLE", "PPE", "OTHER"]).optional(),
  status: z.enum(["OPERATIONAL", "MAINTENANCE", "OUT_OF_SERVICE"]).optional(),
  notes: z.string().optional().nullable(),
  lastCheckDate: z.string().datetime().optional().nullable(),
});

export const upsertVehicleDataSchema = z.object({
  kind: z.enum(["UNCLASSIFIED", "ENGINE", "TANKER", "RESCUE", "AMBULANCE", "SUPPORT", "OTHER"]).optional(),
  unitNumber: z.string().min(1).max(20).optional(),
  plate: z.string().max(20).optional().nullable(),
  year: z.number().int().optional(),
  mileage: z.number().int().min(0).optional(),
  nextOilChangeMileage: z.number().int().min(0).optional(),
});
