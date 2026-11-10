import { z } from "zod";
const revision = z.number().int().min(1).max(2147483646);
const id = z.string().min(1).max(100);
const code = z.string().trim().toUpperCase().min(2).max(40).regex(/^[A-Z0-9][A-Z0-9._/-]+$/);
const notes = z.string().trim().min(10).max(2000);
const pressure = z.number().int().min(1).max(1000);
const minutes = z.number().int().min(0).max(1000000000);
const timestamp = z.string().datetime({ offset: true });
export const airCylinderSchema = z.object({ code, name: z.string().trim().min(3).max(140), serialNumber: z.string().trim().toUpperCase().min(2).max(100), ratedPressureBar: pressure, vehicleAssetId: id.nullish(), externalOwner: z.string().trim().min(3).max(140).nullish() });
export const airCompressorSchema = z.object({ code, name: z.string().trim().min(3).max(140), maxPressureBar: pressure, filterLifeMinutes: minutes.min(1), filterReference: z.string().trim().min(3).max(200), filterInstalledAt: timestamp, initialTotalMinutes: minutes.default(0), initialFilterUsedMinutes: minutes.default(0) }).refine((input) => input.initialFilterUsedMinutes <= input.initialTotalMinutes, { message: "El uso del filtro no puede superar el total del compresor" });
export const airRevisionSchema = z.object({ revision, notes });
export const airMoveSchema = airRevisionSchema.extend({ vehicleAssetId: id.nullable() });
export const airPressureSchema = airRevisionSchema.extend({ pressureBar: z.number().int().min(0).max(1000) });
export const airStatusSchema = airRevisionSchema.extend({ status: z.enum(["OPERATIONAL", "MAINTENANCE", "OUT_OF_SERVICE"]), airQualityReference: z.string().trim().min(3).max(200).optional(), airQualityValidUntil: z.string().date().optional() });
export const airHydroSchema = airRevisionSchema.extend({ result: z.enum(["PASS", "FAIL"]), testedOn: z.string().date(), validUntil: z.string().date().nullable(), certificateReference: z.string().trim().min(3).max(200) }).refine((value) => value.result === "PASS" ? !!value.validUntil && value.validUntil >= value.testedOn : value.validUntil === null, { path: ["validUntil"], message: "Una prueba aprobada requiere vencimiento documentado; una rechazada no tiene vigencia" });
export const airFilterSchema = airRevisionSchema.extend({ filterLifeMinutes: minutes.min(1), filterReference: z.string().trim().min(3).max(200) });
export const airFillSchema = z.object({
  operationKey: z.string().uuid(), compressorId: id, revision, startedAt: timestamp, endedAt: timestamp,
  operatorUserId: id, helperUserIds: z.array(id).max(20).default([]),
  reason: z.enum(["SERVICE", "MAINTENANCE", "TRAINING", "OTHER"]), notes,
  items: z.array(z.object({ cylinderId: id, revision, pressureBar: pressure })).min(1).max(20),
}).superRefine((value, ctx) => {
  if (new Set(value.items.map((item) => item.cylinderId)).size !== value.items.length) ctx.addIssue({ code: "custom", path: ["items"], message: "No repita cilindros" });
  if (new Set(value.helperUserIds).size !== value.helperUserIds.length || value.helperUserIds.includes(value.operatorUserId)) ctx.addIssue({ code: "custom", path: ["helperUserIds"], message: "No repita participantes ni al encargado" });
});
export const airListSchema = z.object({ q: z.string().trim().max(140).default(""), page: z.coerce.number().int().min(1).max(10000).default(1), retired: z.enum(["true", "false"]).default("false"), cylinderId: id.optional(), compressorId: id.optional() });
