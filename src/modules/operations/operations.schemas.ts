import { z } from "zod";

export const dateSchema = z.string().date();
const text = (max: number) => z.string().trim().max(max).nullish();
export const revisionSchema = z.number().int().min(1);
export const availabilityQuerySchema = z.object({ date: dateSchema });
export const availabilitySchema = z.object({
  userId: z.string().min(1).optional(),
  date: dateSchema,
  period: z.enum(["DAY", "NIGHT"]),
  status: z.enum(["AVAILABLE", "ON_CALL", "UNAVAILABLE"]),
  notes: text(1000),
  revision: z.number().int().min(0).default(0),
});

export const maintenanceQuerySchema = z.object({
  assetId: z.string().min(1).optional(),
  status: z.enum(["OPEN", "IN_PROGRESS", "RESOLVED", "CANCELLED"]).optional(),
});
export const maintenanceSchema = z.object({
  publishTask: z.boolean().default(true),
  assetId: z.string().min(1),
  title: z.string().trim().min(3).max(140),
  description: z.string().trim().min(10).max(10000),
  blocksOperation: z.boolean().default(true),
  dueAt: dateSchema.nullish(),
  responsibleUserId: text(100),
});
export const maintenanceTransitionSchema = z.object({
  revision: revisionSchema,
  status: z.enum(["IN_PROGRESS", "RESOLVED", "CANCELLED"]),
  resolution: text(10000),
  costCents: z.number().int().min(0).max(2147483647).nullish(),
}).refine((value) => !["RESOLVED", "CANCELLED"].includes(value.status) || (value.resolution?.length || 0) >= 10, {
  path: ["resolution"], message: "Describa la resolucion o el motivo de cancelacion (minimo 10 caracteres)",
});

export const documentQuerySchema = z.object({
  kind: z.enum(["PROTOCOL", "SHIFT_REPORT", "INCIDENT_REPORT"]).optional(),
  status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]).optional(),
});
export const documentFields = z.object({
  kind: z.enum(["PROTOCOL", "SHIFT_REPORT", "INCIDENT_REPORT"]),
  title: z.string().trim().min(3).max(160),
  category: z.string().trim().min(2).max(80),
  body: z.string().trim().min(10).max(40000),
  externalUrl: text(500).refine((value) => {
    if (!value) return true;
    try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password; }
    catch { return false; }
  }, "El enlace debe usar HTTPS y no contener credenciales"),
  shiftId: text(100),
  incidentId: text(100),
});
function documentSubject(value: z.infer<typeof documentFields>) {
  if (value.kind === "PROTOCOL") return !value.shiftId && !value.incidentId;
  if (value.kind === "SHIFT_REPORT") return Boolean(value.shiftId) && !value.incidentId;
  return Boolean(value.incidentId) && !value.shiftId;
}
export const createDocumentSchema = documentFields.refine(documentSubject, "Seleccione la guardia o intervencion correspondiente al tipo de acta");
export const updateDocumentSchema = documentFields.extend({ revision: revisionSchema }).refine(documentSubject, "La referencia del acta no coincide con su tipo");
export const documentTransitionSchema = z.object({ revision: revisionSchema, status: z.enum(["PUBLISHED", "ARCHIVED"]) });

export class OperationError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export function isOperationsManager(role: string) {
  return role === "ADMIN" || role === "OPERATOR";
}
export function isDutyManager(role: string) { return isOperationsManager(role) || role === "GUARD"; }
export function assertMaintenanceTransition(current: string, next: string) {
  const allowed: Record<string, string[]> = {
    OPEN: ["IN_PROGRESS", "RESOLVED", "CANCELLED"],
    IN_PROGRESS: ["RESOLVED", "CANCELLED"],
  };
  if (!allowed[current]?.includes(next)) throw new OperationError(409, "El trabajo ya esta cerrado o la transicion no es valida");
}
export function assertDocumentTransition(current: string, next: string) {
  if (!((current === "DRAFT" && ["PUBLISHED", "ARCHIVED"].includes(next)) || (current === "PUBLISHED" && next === "ARCHIVED"))) {
    throw new OperationError(409, "El documento ya cambio de estado. Recargue la lista.");
  }
}
