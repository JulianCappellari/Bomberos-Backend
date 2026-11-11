import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../config/prisma";
import { serializable } from "../../utils/transaction";
import { OperationError } from "../operations/operations.schemas";
import { canWriteIncident } from "./incident-access";

// 62: instituciones que participaron en una intervencion. Las cargan quienes pueden escribir la planilla
// (presencia QR o administracion) mientras esta abierta; cerrada, solo administracion. Nada se borra:
// se anula con motivo y todo queda auditado.
export const AGENCY_TYPES = ["FIRE_STATION", "POLICE", "MEDICAL", "CIVIL_DEFENSE", "UTILITY", "MUNICIPAL", "OTHER"] as const;
type Actor = { userId: string; role: string };

const dateField = z.string().datetime({ offset: true }).nullable().optional();
const agencySchema = z.object({
  agencyType: z.enum(AGENCY_TYPES),
  name: z.string().trim().min(3).max(160),
  contactId: z.string().min(1).max(100).nullable().optional(),
  unit: z.string().trim().max(80).default(""),
  inCharge: z.string().trim().max(120).default(""),
  phone: z.string().trim().max(40).nullable().optional(),
  arrivedAt: dateField,
  leftAt: dateField,
  notes: z.string().trim().max(2000).default(""),
}).strict();

async function loadIncident(tx: Parameters<typeof canWriteIncident>[0], id: string) {
  const incident = await tx.incident.findUnique({ where: { id }, select: { id: true, status: true, voidedAt: true, occurredAt: true } });
  if (!incident || incident.voidedAt) throw new OperationError(404, "Intervención no encontrada");
  return incident;
}
async function assertCanEdit(tx: Parameters<typeof canWriteIncident>[0], actor: Actor, incident: { status: string }) {
  if (incident.status !== "OPEN") { if (actor.role !== "ADMIN") throw new OperationError(403, "La intervención está cerrada: solo administración corrige las instituciones"); return; }
  if (!(await canWriteIncident(tx, actor))) throw new OperationError(403, "Para cargar instituciones tenés que estar en el cuartel con ingreso por QR");
}
// Anti-fraude: horarios coherentes con la intervencion y nunca en el futuro.
function checkTimes(data: { arrivedAt?: string | null; leftAt?: string | null }, occurredAt: Date) {
  const limit = Date.now() + 5 * 60_000, earliest = occurredAt.getTime() - 60 * 60_000;
  for (const [label, value] of [["llegada", data.arrivedAt], ["retiro", data.leftAt]] as const) {
    if (!value) continue;
    const t = new Date(value).getTime();
    if (t > limit) throw new OperationError(400, `La hora de ${label} no puede ser futura`);
    if (t < earliest) throw new OperationError(400, `La hora de ${label} es anterior al inicio de la intervención`);
  }
  if (data.arrivedAt && data.leftAt && new Date(data.leftAt) < new Date(data.arrivedAt)) throw new OperationError(400, "El retiro no puede ser anterior a la llegada");
}
const select = { id: true, agencyType: true, name: true, contactId: true, unit: true, inCharge: true, phone: true, arrivedAt: true, leftAt: true, notes: true, revision: true, voidedAt: true, voidReason: true, createdAt: true, createdBy: { select: { username: true, profile: { select: { fullName: true } } } }, contact: { select: { name: true, phone: true } } } as const;

const router = Router({ mergeParams: true });

router.get("/", async (req, res) => {
  const incidentId = String((req.params as unknown as { id: string }).id);
  const incident = await prisma.incident.findUnique({ where: { id: incidentId }, select: { status: true } });
  if (!incident) throw new OperationError(404, "Intervención no encontrada");
  const rows = await prisma.incidentAgency.findMany({ where: { incidentId }, orderBy: [{ arrivedAt: "asc" }, { createdAt: "asc" }], select });
  const canEdit = incident.status === "OPEN" ? await canWriteIncident(prisma as never, req.user!) : req.user!.role === "ADMIN";
  res.json({ canEdit, items: rows });
});

router.post("/", async (req, res) => {
  const incidentId = String((req.params as unknown as { id: string }).id), data = agencySchema.parse(req.body), actor = req.user!;
  const row = await serializable(async (tx) => {
    const incident = await loadIncident(tx, incidentId);
    await assertCanEdit(tx, actor, incident);
    checkTimes(data, incident.occurredAt);
    if (data.contactId && !(await tx.operationalContact.findFirst({ where: { id: data.contactId, deletedAt: null }, select: { id: true } }))) throw new OperationError(400, "El contacto elegido no existe");
    const duplicate = await tx.incidentAgency.findFirst({ where: { incidentId, voidedAt: null, name: { equals: data.name, mode: "insensitive" }, unit: { equals: data.unit, mode: "insensitive" } }, select: { id: true } });
    if (duplicate) throw new OperationError(409, "Esa institución y unidad ya están cargadas en esta intervención");
    const created = await tx.incidentAgency.create({ data: { ...data, contactId: data.contactId ?? null, phone: data.phone || null, arrivedAt: data.arrivedAt ? new Date(data.arrivedAt) : null, leftAt: data.leftAt ? new Date(data.leftAt) : null, incidentId, createdByUserId: actor.userId }, select });
    await tx.auditLog.create({ data: { actorUserId: actor.userId, action: "INCIDENT_AGENCY_ADDED", entityType: "Incident", entityId: incidentId, metadata: { agencyId: created.id, agencyType: data.agencyType, name: data.name, unit: data.unit, arrivedAt: data.arrivedAt ?? null, leftAt: data.leftAt ?? null } } });
    return created;
  });
  res.status(201).json(row);
});

router.put("/:agencyId", async (req, res) => {
  const incidentId = String((req.params as unknown as { id: string }).id), agencyId = String(req.params.agencyId), actor = req.user!;
  const data = agencySchema.extend({ revision: z.number().int().min(1) }).parse(req.body);
  const row = await serializable(async (tx) => {
    const incident = await loadIncident(tx, incidentId);
    await assertCanEdit(tx, actor, incident);
    checkTimes(data, incident.occurredAt);
    const before = await tx.incidentAgency.findFirst({ where: { id: agencyId, incidentId } });
    if (!before) throw new OperationError(404, "Institución no encontrada");
    if (before.voidedAt) throw new OperationError(409, "La carga está anulada");
    const { revision, ...fields } = data;
    const changed = await tx.incidentAgency.updateMany({ where: { id: agencyId, revision }, data: { ...fields, contactId: fields.contactId ?? null, phone: fields.phone || null, arrivedAt: fields.arrivedAt ? new Date(fields.arrivedAt) : null, leftAt: fields.leftAt ? new Date(fields.leftAt) : null, revision: { increment: 1 } } });
    if (!changed.count) throw new OperationError(409, "Otra persona modificó esta carga; actualizá antes de guardar");
    await tx.auditLog.create({ data: { actorUserId: actor.userId, action: "INCIDENT_AGENCY_UPDATED", entityType: "Incident", entityId: incidentId, metadata: { agencyId, before: { name: before.name, unit: before.unit, inCharge: before.inCharge, arrivedAt: before.arrivedAt, leftAt: before.leftAt }, after: fields } } });
    return tx.incidentAgency.findUniqueOrThrow({ where: { id: agencyId }, select });
  });
  res.json(row);
});

router.post("/:agencyId/void", async (req, res) => {
  const incidentId = String((req.params as unknown as { id: string }).id), agencyId = String(req.params.agencyId), actor = req.user!;
  const reason = z.object({ reason: z.string().trim().min(10).max(1000) }).strict().parse(req.body).reason;
  await serializable(async (tx) => {
    const incident = await loadIncident(tx, incidentId);
    await assertCanEdit(tx, actor, incident);
    const changed = await tx.incidentAgency.updateMany({ where: { id: agencyId, incidentId, voidedAt: null }, data: { voidedAt: new Date(), voidReason: reason, revision: { increment: 1 } } });
    if (!changed.count) throw new OperationError(409, "La carga no existe o ya fue anulada");
    await tx.auditLog.create({ data: { actorUserId: actor.userId, action: "INCIDENT_AGENCY_VOIDED", entityType: "Incident", entityId: incidentId, metadata: { agencyId, reason } } });
  });
  res.json({ voided: true });
});

export default router;
