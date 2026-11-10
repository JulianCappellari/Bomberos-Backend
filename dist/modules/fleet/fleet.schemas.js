"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.waterPaymentSchema = exports.waterSchema = exports.voidSchema = exports.fleetQuery = exports.fuelSchema = void 0;
exports.parseLiters = parseLiters;
const zod_1 = require("zod");
const work_schemas_1 = require("../work/work.schemas");
// No locale guessing: dots and commas both mean decimals, never thousands.
function parseLiters(value) {
    const text = String(value ?? "").trim();
    if (!/^\d{1,5}([.,]\d{1,3})?$/.test(text))
        return null;
    const [whole, decimal = ""] = text.replace(",", ".").split(".");
    const milliliters = Number(whole) * 1000 + Number(decimal.padEnd(3, "0"));
    return milliliters > 0 && milliliters <= 10000000 ? milliliters : null;
}
const cents = zod_1.z.number().int().min(0).max(1000000000);
const odometer = zod_1.z.number().int().min(0).max(10000000);
exports.fuelSchema = zod_1.z.object({
    operationKey: zod_1.z.string().uuid(), assetId: work_schemas_1.idSchema, occurredAt: zod_1.z.string().datetime({ offset: true }),
    liters: zod_1.z.union([zod_1.z.string().max(20), zod_1.z.number().finite()]).transform(parseLiters).refine((v) => v !== null, "Litros invalidos: use hasta tres decimales, sin separador de miles"),
    costCents: cents.nullish(), odometer: odometer.nullish(),
    reason: zod_1.z.enum(["EMERGENCY", "TRAINING", "SERVICE", "WATER", "OTHER"]), notes: zod_1.z.string().trim().max(2000).default(""),
});
exports.fleetQuery = work_schemas_1.pageQuery.extend({ assetId: work_schemas_1.idSchema.optional(), month: zod_1.z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional() });
exports.voidSchema = zod_1.z.object({ notes: zod_1.z.string().trim().min(10).max(2000) });
exports.waterSchema = zod_1.z.object({
    operationKey: zod_1.z.string().uuid(), assetId: work_schemas_1.idSchema, customer: zod_1.z.string().trim().min(3).max(160), destination: zod_1.z.string().trim().min(3).max(200),
    departedAt: zod_1.z.string().datetime({ offset: true }), returnedAt: zod_1.z.string().datetime({ offset: true }), startOdometer: odometer, endOdometer: odometer,
    tripCount: zod_1.z.number().int().min(1).max(100), chargeCents: cents, leaderUserId: work_schemas_1.idSchema, notes: zod_1.z.string().trim().max(2000).default(""),
    crew: zod_1.z.array(zod_1.z.object({ userId: work_schemas_1.idSchema, compensationCents: cents })).min(1).max(30),
}).superRefine((v, ctx) => {
    if (v.endOdometer < v.startOdometer)
        ctx.addIssue({ code: "custom", path: ["endOdometer"], message: "El kilometraje de regreso no puede ser menor" });
    if (new Date(v.returnedAt) <= new Date(v.departedAt))
        ctx.addIssue({ code: "custom", path: ["returnedAt"], message: "El regreso debe ser posterior a la salida" });
    if (new Set(v.crew.map((p) => p.userId)).size !== v.crew.length)
        ctx.addIssue({ code: "custom", path: ["crew"], message: "No repita participantes" });
    if (!v.crew.some((p) => p.userId === v.leaderUserId))
        ctx.addIssue({ code: "custom", path: ["leaderUserId"], message: "El encargado debe integrar la tripulacion" });
});
exports.waterPaymentSchema = zod_1.z.object({ revision: work_schemas_1.revision, kind: zod_1.z.enum(["CLIENT", "CREW"]), userId: work_schemas_1.idSchema.optional(), reverse: zod_1.z.boolean().default(false), notes: zod_1.z.string().trim().min(5).max(2000) })
    .refine((v) => v.kind === "CREW" ? Boolean(v.userId) : !v.userId, "Seleccione integrante solo para pago a bombero");
