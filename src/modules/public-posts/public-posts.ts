import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../config/prisma";
import { authenticate } from "../../middlewares/auth.middleware";
import { authorize } from "../../middlewares/role.middleware";
import { rateLimit } from "../../middlewares/rate-limit.middleware";
import { serializable } from "../../utils/transaction";
import { OperationError } from "../operations/operations.schemas";
import { sanitizeTaskPhotos } from "../work/work-photos";

// Novedades publicas: lo ve cualquier persona sin iniciar sesion (comunidad y medios). Capacitaciones, noticias y,
// sobre todo, el informe de un incidente ya finalizado. Lo redacta y publica jefatura; nunca incluye datos personales.
export const POST_KINDS = ["INCIDENT", "TRAINING", "NEWS"] as const;
const AGENCY_LABEL: Record<string, string> = { FIRE_STATION: "Bomberos", POLICE: "Policía", MEDICAL: "Servicio de emergencias médicas", CIVIL_DEFENSE: "Defensa Civil", UTILITY: "Servicio público", MUNICIPAL: "Municipalidad", OTHER: "Institución" };
const TYPE_LABEL: Record<string, string> = { FIRE: "Incendio", RESCUE: "Rescate", ACCIDENT: "Accidente", CHEMICAL: "Materiales peligrosos", MEDICAL: "Asistencia", FLOOD: "Inundación", OTHER: "Intervención" };
const publicSelect = { id: true, kind: true, title: true, summary: true, body: true, happenedOn: true, publishedAt: true, units: true, peopleCount: true, agencies: true, photos: { orderBy: { position: "asc" as const }, select: { id: true } } } as const;

const postSchema = z.object({
  kind: z.enum(POST_KINDS),
  title: z.string().trim().min(5).max(160),
  summary: z.string().trim().min(10).max(400),
  body: z.string().trim().min(10).max(20000),
  incidentId: z.string().min(1).max(100).nullable().optional(),
  happenedOn: z.string().date().nullable().optional(),
  // Moviles que salieron, personas que fueron y otras instituciones que participaron (se muestran como ficha del informe).
  units: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  peopleCount: z.number().int().min(0).max(500).nullable().optional(),
  agencies: z.array(z.string().trim().min(2).max(200)).max(20).default([]),
  photos: z.array(z.string().min(1)).max(6).optional(),
  keepPhotoIds: z.array(z.string().min(1).max(100)).max(6).optional(),
}).strict();

// ---------- Publico (sin sesion) ----------
export const publicRouter = Router();
publicRouter.use(rateLimit({ windowMs: 60_000, maxRequests: 120 }));
publicRouter.get("/posts", async (req, res) => {
  const { kind, page } = z.object({ kind: z.enum(POST_KINDS).optional(), page: z.coerce.number().int().min(1).max(500).default(1) }).parse(req.query);
  const where = { status: "PUBLISHED", ...(kind ? { kind } : {}) };
  const [items, total] = await Promise.all([
    prisma.publicPost.findMany({ where, orderBy: [{ publishedAt: "desc" }, { id: "desc" }], skip: (page - 1) * 12, take: 12, select: publicSelect }),
    prisma.publicPost.count({ where }),
  ]);
  res.setHeader("Cache-Control", "public, max-age=60");
  res.json({ items, total, page, pageSize: 12 });
});
publicRouter.get("/posts/:id", async (req, res) => {
  const post = await prisma.publicPost.findFirst({ where: { id: String(req.params.id), status: "PUBLISHED" }, select: publicSelect });
  if (!post) throw new OperationError(404, "Publicación no encontrada");
  res.setHeader("Cache-Control", "public, max-age=60");
  res.json(post);
});
publicRouter.get("/posts/:id/photos/:photoId", async (req, res) => {
  const photo = await prisma.publicPostPhoto.findFirst({ where: { id: String(req.params.photoId), postId: String(req.params.id), post: { status: "PUBLISHED" } }, select: { bytes: true, sha256: true } });
  if (!photo) throw new OperationError(404, "Foto no encontrada");
  res.setHeader("Content-Type", "image/jpeg");
  res.setHeader("Cache-Control", "public, max-age=86400, immutable");
  res.setHeader("ETag", `"${photo.sha256}"`);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.send(Buffer.from(photo.bytes));
});

// ---------- Gestion (jefatura) ----------
export const postsAdminRouter = Router();
postsAdminRouter.use(authenticate, authorize("ADMIN", "OPERATOR"));
postsAdminRouter.get("/", async (_req, res) => {
  res.json(await prisma.publicPost.findMany({ orderBy: [{ updatedAt: "desc" }], take: 200, select: { ...publicSelect, status: true, incidentId: true, revision: true, updatedAt: true } }));
});
// Borrador del informe a partir de una intervencion finalizada: solo datos generales, sin nombres ni telefonos.
postsAdminRouter.get("/incident-draft/:incidentId", async (req, res) => {
  const incident = await prisma.incident.findUnique({ where: { id: String(req.params.incidentId) }, include: {
    movements: { where: { OR: [{ departureId: null }, { departure: { is: { voidedAt: null } } }] }, select: { asset: { select: { name: true, vehicle: { select: { unitNumber: true } } } }, departedAt: true, returnedAt: true, crew: { select: { userId: true } } } },
    agencies: { where: { voidedAt: null }, select: { agencyType: true, name: true, unit: true, inCharge: true } },
  } });
  if (!incident || incident.voidedAt) throw new OperationError(404, "Intervención no encontrada");
  if (incident.status !== "CLOSED") throw new OperationError(409, "Solo se informa públicamente una intervención finalizada");
  const kind = TYPE_LABEL[incident.type] ?? "Intervención";
  const units = [...new Set(incident.movements.map((m) => m.asset.vehicle?.unitNumber ?? m.asset.name))];
  const peopleCount = new Set(incident.movements.flatMap((m) => m.crew.map((c) => c.userId))).size;
  const from = incident.occurredAt, to = incident.closedAt ?? incident.updatedAt;
  const minutes = Math.max(0, Math.round((+to - +from) / 60000));
  const hm = (d: Date) => d.toLocaleTimeString("es-AR", { hourCycle: "h23", hour: "2-digit", minute: "2-digit", timeZone: "America/Argentina/Buenos_Aires" });
  // Otras instituciones y quien estuvo a cargo de cada una.
  const agencies = [...new Set(incident.agencies.map((a) => [`${AGENCY_LABEL[a.agencyType] ?? "Institución"}: ${a.name}`, a.unit && `unidad ${a.unit}`, a.inCharge && `a cargo de ${a.inCharge}`].filter(Boolean).join(", ")))];
  const body = [
    `${kind} atendido por Bomberos Voluntarios de Sampacho.`,
    `Lugar: ${incident.location}.`,
    `Aviso: ${from.toLocaleDateString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" })} a las ${hm(from)}. Finalización: ${hm(to)} (${minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min`} de trabajo).`,
    units.length ? `${units.length === 1 ? "Móvil que salió" : "Móviles que salieron"}: ${units.join(", ")}.` : "",
    peopleCount ? `Personal que fue al lugar: ${peopleCount} ${peopleCount === 1 ? "bombero" : "bomberos"}.` : "",
    agencies.length ? `También participaron: ${agencies.join("; ")}.` : "No participaron otras instituciones.",
    incident.closingReport ? `\n${incident.closingReport}` : "",
    "\nRevisá el texto antes de publicar: no incluyas nombres, teléfonos ni datos de personas asistidas.",
  ].filter(Boolean).join("\n");
  res.json({ kind: "INCIDENT", incidentId: incident.id, title: `${kind} en ${incident.location}`.slice(0, 160), summary: `${kind} en ${incident.location}. ${units.length ? `Intervinieron ${units.length === 1 ? "la unidad" : "las unidades"} ${units.join(", ")}.` : ""}`.trim().slice(0, 400), body, happenedOn: from.toISOString().slice(0, 10), units, peopleCount, agencies });
});
postsAdminRouter.post("/", async (req, res) => {
  const input = postSchema.parse(req.body);
  const photos = input.photos?.length ? await sanitizeTaskPhotos(input.photos) : [];
  if (input.incidentId) {
    const incident = await prisma.incident.findUnique({ where: { id: input.incidentId }, select: { status: true, voidedAt: true } });
    if (!incident || incident.voidedAt || incident.status !== "CLOSED") throw new OperationError(409, "Solo se informa públicamente una intervención finalizada");
  }
  const row = await serializable(async (tx) => {
    const created = await tx.publicPost.create({ data: { kind: input.kind, title: input.title, summary: input.summary, body: input.body, units: input.units, peopleCount: input.peopleCount ?? null, agencies: input.agencies, incidentId: input.incidentId ?? null, happenedOn: input.happenedOn ? new Date(input.happenedOn) : null, authorUserId: req.user!.userId, photos: { create: photos.map((p, position) => ({ bytes: p.bytes, sha256: p.sha256, position })) } }, select: { id: true } });
    await tx.auditLog.create({ data: { actorUserId: req.user!.userId, action: "PUBLIC_POST_CREATED", entityType: "PublicPost", entityId: created.id, metadata: { kind: input.kind, title: input.title, photos: photos.length } } });
    return created;
  });
  res.status(201).json(row);
});
postsAdminRouter.put("/:id", async (req, res) => {
  const input = postSchema.extend({ revision: z.number().int().positive() }).parse(req.body);
  const photos = input.photos?.length ? await sanitizeTaskPhotos(input.photos) : [];
  const id = String(req.params.id);
  await serializable(async (tx) => {
    const current = await tx.publicPost.findUnique({ where: { id }, include: { photos: { select: { id: true } } } });
    if (!current || current.revision !== input.revision) throw new OperationError(409, "La publicación cambió; recargá");
    const keep = new Set(input.keepPhotoIds ?? current.photos.map((p) => p.id));
    if (keep.size + photos.length > 6) throw new OperationError(400, "Hasta 6 fotos por publicación");
    await tx.publicPostPhoto.deleteMany({ where: { postId: id, id: { notIn: [...keep] } } });
    await tx.publicPost.update({ where: { id }, data: { kind: input.kind, title: input.title, summary: input.summary, body: input.body, units: input.units, peopleCount: input.peopleCount ?? null, agencies: input.agencies, happenedOn: input.happenedOn ? new Date(input.happenedOn) : null, revision: { increment: 1 }, photos: { create: photos.map((p, i) => ({ bytes: p.bytes, sha256: p.sha256, position: keep.size + i })) } } });
    await tx.auditLog.create({ data: { actorUserId: req.user!.userId, action: "PUBLIC_POST_UPDATED", entityType: "PublicPost", entityId: id, metadata: { title: input.title, published: current.status === "PUBLISHED" } } });
  });
  res.json({ id });
});
async function setPublished(id: string, publish: boolean, req: import("express").Request) {
  const { revision } = z.object({ revision: z.number().int().positive() }).strict().parse(req.body);
  const row = await serializable(async (tx) => {
    const changed = await tx.publicPost.updateMany({ where: { id, revision }, data: { status: publish ? "PUBLISHED" : "ARCHIVED", ...(publish ? { publishedAt: new Date() } : {}), revision: { increment: 1 } } });
    if (!changed.count) throw new OperationError(409, "La publicación cambió; recargá");
    await tx.auditLog.create({ data: { actorUserId: req.user!.userId, action: publish ? "PUBLIC_POST_PUBLISHED" : "PUBLIC_POST_UNPUBLISHED", entityType: "PublicPost", entityId: id, metadata: {} } });
    return tx.publicPost.findUniqueOrThrow({ where: { id }, select: { id: true, status: true, revision: true, publishedAt: true } });
  });
  return row;
}
postsAdminRouter.post("/:id/publish", async (req, res) => { res.json(await setPublished(String(req.params.id), true, req)); });
postsAdminRouter.post("/:id/unpublish", async (req, res) => { res.json(await setPublished(String(req.params.id), false, req)); });
