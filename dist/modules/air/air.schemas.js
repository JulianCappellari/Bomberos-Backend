"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.airListSchema = exports.airFillSchema = exports.airFilterSchema = exports.airHydroSchema = exports.airStatusSchema = exports.airPressureSchema = exports.airMoveSchema = exports.airRevisionSchema = exports.airCompressorSchema = exports.airCylinderSchema = void 0;
const zod_1 = require("zod");
const revision = zod_1.z.number().int().min(1).max(2147483646);
const id = zod_1.z.string().min(1).max(100);
const code = zod_1.z.string().trim().toUpperCase().min(2).max(40).regex(/^[A-Z0-9][A-Z0-9._/-]+$/);
const notes = zod_1.z.string().trim().min(10).max(2000);
const pressure = zod_1.z.number().int().min(1).max(1000);
const minutes = zod_1.z.number().int().min(0).max(1000000000);
const timestamp = zod_1.z.string().datetime({ offset: true });
exports.airCylinderSchema = zod_1.z.object({ code, name: zod_1.z.string().trim().min(3).max(140), serialNumber: zod_1.z.string().trim().toUpperCase().min(2).max(100), ratedPressureBar: pressure, vehicleAssetId: id.nullish(), externalOwner: zod_1.z.string().trim().min(3).max(140).nullish() });
exports.airCompressorSchema = zod_1.z.object({ code, name: zod_1.z.string().trim().min(3).max(140), maxPressureBar: pressure, filterLifeMinutes: minutes.min(1), filterReference: zod_1.z.string().trim().min(3).max(200), filterInstalledAt: timestamp, initialTotalMinutes: minutes.default(0), initialFilterUsedMinutes: minutes.default(0) }).refine((input) => input.initialFilterUsedMinutes <= input.initialTotalMinutes, { message: "El uso del filtro no puede superar el total del compresor" });
exports.airRevisionSchema = zod_1.z.object({ revision, notes });
exports.airMoveSchema = exports.airRevisionSchema.extend({ vehicleAssetId: id.nullable() });
exports.airPressureSchema = exports.airRevisionSchema.extend({ pressureBar: zod_1.z.number().int().min(0).max(1000) });
exports.airStatusSchema = exports.airRevisionSchema.extend({ status: zod_1.z.enum(["OPERATIONAL", "MAINTENANCE", "OUT_OF_SERVICE"]), airQualityReference: zod_1.z.string().trim().min(3).max(200).optional(), airQualityValidUntil: zod_1.z.string().date().optional() });
exports.airHydroSchema = exports.airRevisionSchema.extend({ result: zod_1.z.enum(["PASS", "FAIL"]), testedOn: zod_1.z.string().date(), validUntil: zod_1.z.string().date().nullable(), certificateReference: zod_1.z.string().trim().min(3).max(200) }).refine((value) => value.result === "PASS" ? !!value.validUntil && value.validUntil >= value.testedOn : value.validUntil === null, { path: ["validUntil"], message: "Una prueba aprobada requiere vencimiento documentado; una rechazada no tiene vigencia" });
exports.airFilterSchema = exports.airRevisionSchema.extend({ filterLifeMinutes: minutes.min(1), filterReference: zod_1.z.string().trim().min(3).max(200) });
exports.airFillSchema = zod_1.z.object({
    operationKey: zod_1.z.string().uuid(), compressorId: id, revision, startedAt: timestamp, endedAt: timestamp,
    operatorUserId: id, helperUserIds: zod_1.z.array(id).max(20).default([]),
    reason: zod_1.z.enum(["SERVICE", "MAINTENANCE", "TRAINING", "OTHER"]), notes,
    items: zod_1.z.array(zod_1.z.object({ cylinderId: id, revision, pressureBar: pressure })).min(1).max(20),
}).superRefine((value, ctx) => {
    if (new Set(value.items.map((item) => item.cylinderId)).size !== value.items.length)
        ctx.addIssue({ code: "custom", path: ["items"], message: "No repita cilindros" });
    if (new Set(value.helperUserIds).size !== value.helperUserIds.length || value.helperUserIds.includes(value.operatorUserId))
        ctx.addIssue({ code: "custom", path: ["helperUserIds"], message: "No repita participantes ni al encargado" });
});
exports.airListSchema = zod_1.z.object({ q: zod_1.z.string().trim().max(140).default(""), page: zod_1.z.coerce.number().int().min(1).max(10000).default(1), retired: zod_1.z.enum(["true", "false"]).default("false"), cylinderId: id.optional(), compressorId: id.optional() });
