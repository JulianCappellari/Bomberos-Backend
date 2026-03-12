import { z } from "zod";

export const createAssetSchema = z.object({
  name: z.string().min(2).max(140),
  assetType: z.enum(["VEHICLE", "PPE", "OTHER"]),
  status: z.enum(["OPERATIONAL", "MAINTENANCE", "OUT_OF_SERVICE"]).optional(),
  notes: z.string().optional().or(z.literal("")),
  lastCheckDate: z.string().optional().or(z.literal("")),
  vehicle: z
    .object({
      plate: z.string().optional().or(z.literal("")),
      year: z.number().int().min(1900).max(2100).optional(),
      mileage: z.number().int().min(0).optional(),
      nextOilChangeMileage: z.number().int().min(0).optional(),
    })
    .optional(),
});

export const updateAssetSchema = z.object({
  name: z.string().min(2).max(140).optional(),
  assetType: z.enum(["VEHICLE", "PPE", "OTHER"]).optional(),
  status: z.enum(["OPERATIONAL", "MAINTENANCE", "OUT_OF_SERVICE"]).optional(),
  notes: z.string().optional().or(z.literal("")),
  lastCheckDate: z.string().optional().or(z.literal("")),
});

export const upsertVehicleSchema = z.object({
  plate: z.string().optional().or(z.literal("")),
  year: z.number().int().min(1900).max(2100).optional(),
  mileage: z.number().int().min(0).optional(),
  nextOilChangeMileage: z.number().int().min(0).optional(),
});

export const createVehicleInventoryItemSchema = z.object({
  name: z.string().min(2).max(140),
  quantity: z.number().int().min(1).optional(),
  state: z.enum(["OK", "REVIEW", "OUT"]).optional(),
  compartment: z.string().optional().or(z.literal("")),
  notes: z.string().optional().or(z.literal("")),
});

export const updateVehicleInventoryItemSchema = z.object({
  name: z.string().min(2).max(140).optional(),
  quantity: z.number().int().min(1).optional(),
  state: z.enum(["OK", "REVIEW", "OUT"]).optional(),
  compartment: z.string().optional().or(z.literal("")),
  notes: z.string().optional().or(z.literal("")),
});