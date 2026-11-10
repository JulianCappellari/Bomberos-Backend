import { z } from "zod";
import { idSchema, pageQuery, revision } from "../work/work.schemas";

// No locale guessing: dots and commas both mean decimals, never thousands.
export function parseLiters(value: unknown): number | null {
  const text = String(value ?? "").trim();
  if (!/^\d{1,5}([.,]\d{1,3})?$/.test(text)) return null;
  const [whole, decimal = ""] = text.replace(",", ".").split(".");
  const milliliters = Number(whole) * 1000 + Number(decimal.padEnd(3, "0"));
  return milliliters > 0 && milliliters <= 10000000 ? milliliters : null;
}
const cents = z.number().int().min(0).max(1000000000);
const odometer = z.number().int().min(0).max(10000000);
export const fuelSchema = z.object({
  operationKey: z.string().uuid(), assetId: idSchema, occurredAt: z.string().datetime({ offset: true }),
  liters: z.union([z.string().max(20), z.number().finite()]).transform(parseLiters).refine((v) => v !== null, "Litros invalidos: use hasta tres decimales, sin separador de miles"),
  costCents: cents.nullish(), odometer: odometer.nullish(),
  reason: z.enum(["EMERGENCY", "TRAINING", "SERVICE", "WATER", "OTHER"]), notes: z.string().trim().max(2000).default(""),
});
export const fleetQuery = pageQuery.extend({ assetId: idSchema.optional(), month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional() });
export const voidSchema = z.object({ notes: z.string().trim().min(10).max(2000) });
export const waterSchema = z.object({
  operationKey: z.string().uuid(), assetId: idSchema, customer: z.string().trim().min(3).max(160), destination: z.string().trim().min(3).max(200),
  departedAt: z.string().datetime({ offset: true }), returnedAt: z.string().datetime({ offset: true }), startOdometer: odometer, endOdometer: odometer,
  tripCount: z.number().int().min(1).max(100), chargeCents: cents, leaderUserId: idSchema, notes: z.string().trim().max(2000).default(""),
  crew: z.array(z.object({ userId: idSchema, compensationCents: cents })).min(1).max(30),
}).superRefine((v, ctx) => {
  if (v.endOdometer < v.startOdometer) ctx.addIssue({ code: "custom", path: ["endOdometer"], message: "El kilometraje de regreso no puede ser menor" });
  if (new Date(v.returnedAt) <= new Date(v.departedAt)) ctx.addIssue({ code: "custom", path: ["returnedAt"], message: "El regreso debe ser posterior a la salida" });
  if (new Set(v.crew.map((p) => p.userId)).size !== v.crew.length) ctx.addIssue({ code: "custom", path: ["crew"], message: "No repita participantes" });
  if (!v.crew.some((p) => p.userId === v.leaderUserId)) ctx.addIssue({ code: "custom", path: ["leaderUserId"], message: "El encargado debe integrar la tripulacion" });
});
export const waterPaymentSchema = z.object({ revision, kind: z.enum(["CLIENT", "CREW"]), userId: idSchema.optional(), reverse: z.boolean().default(false), notes: z.string().trim().min(5).max(2000) })
  .refine((v) => v.kind === "CREW" ? Boolean(v.userId) : !v.userId, "Seleccione integrante solo para pago a bombero");
