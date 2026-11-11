import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../config/prisma";
import { serializable } from "../../utils/transaction";
import { lockRow } from "../../utils/database-schema";
import { OperationError } from "../operations/operations.schemas";
import { notify } from "../members/notifications.service";

// Deposito del cuartel. Lo maneja el encargado de vestimenta y materiales (permiso especial PPE) o administracion.
export const SUPPLY_CATEGORIES = ["VESTIMENTA", "EPP", "MOVIL", "CUARTEL", "LIMPIEZA", "HERRAMIENTA", "OTRO"] as const;
export const MOVEMENT_TYPES = ["IN", "OUT", "ASSIGN", "LOSS", "ADJUST"] as const;
export const REQUEST_STATUSES = ["PENDING", "APPROVED", "ORDERED", "DELIVERED", "REJECTED", "CANCELLED"] as const;
type Actor = { userId: string; role: string; permissions?: string[] };

export const isSupplyManager = (actor: Actor) => actor.role === "ADMIN" || Boolean(actor.permissions?.includes("PPE"));
// Pedidos de materiales: oficial (ADMIN), sub oficial (OPERATOR), administracion y la guardia; tambien el encargado.
export const canRequestMaterials = (actor: Actor) => ["ADMIN", "OPERATOR", "GUARD"].includes(actor.role) || isSupplyManager(actor);
function requireManager(actor: Actor) { if (!isSupplyManager(actor)) throw new OperationError(403, "Solo el encargado de vestimenta y materiales o administración"); }

const text = (max: number) => z.string().trim().max(max);
export const itemSchema = z.object({
  name: text(140).min(2), category: z.enum(SUPPLY_CATEGORIES), size: text(30).optional().nullable(), unit: text(20).min(1).default("unidad"),
  minQuantity: z.number().int().min(0).max(100000).default(0), location: text(120).optional().nullable(), notes: text(1000).optional().nullable(),
}).strict();
export const createItemSchema = itemSchema.extend({ initialQuantity: z.number().int().min(0).max(100000).default(0) }).strict();
export const updateItemSchema = itemSchema.extend({ revision: z.number().int().positive() }).strict();
export const movementSchema = z.object({
  type: z.enum(MOVEMENT_TYPES), quantity: z.number().int().min(0).max(100000), reason: text(500).min(3, "Indicá el motivo"),
  assignedUserId: z.string().min(1).max(100).optional().nullable(), vehicleId: z.string().min(1).max(100).optional().nullable(),
}).strict().refine((v) => v.type === "ADJUST" || v.quantity > 0, { message: "La cantidad debe ser mayor a cero", path: ["quantity"] })
  .refine((v) => v.type !== "ASSIGN" || Boolean(v.assignedUserId || v.vehicleId), { message: "Indicá a quién o a qué móvil se entrega", path: ["assignedUserId"] });
export const requestSchema = z.object({
  title: text(160).min(3, "Describí qué se necesita"), details: text(2000).optional().nullable(), destination: z.enum(["VEHICLE", "STATION"]),
  vehicleId: z.string().min(1).max(100).optional().nullable(), quantity: z.number().int().min(1).max(10000).default(1), priority: z.enum(["NORMAL", "URGENT"]).default("NORMAL"),
}).strict().refine((v) => v.destination !== "VEHICLE" || Boolean(v.vehicleId), { message: "Elegí el móvil", path: ["vehicleId"] });
export const decideSchema = z.object({
  status: z.enum(["APPROVED", "ORDERED", "DELIVERED", "REJECTED"]), notes: text(2000).optional().nullable(), revision: z.number().int().positive(),
  supplyItemId: z.string().min(1).max(100).optional().nullable(),
}).strict().refine((v) => v.status !== "REJECTED" || Boolean(v.notes && v.notes.length >= 5), { message: "Indicá por qué se rechaza", path: ["notes"] });

async function managerIds(tx: Prisma.TransactionClient) {
  const rows = await tx.user.findMany({ where: { isActive: true, deletedAt: null, isPendingApproval: false, specialPermissions: { has: "PPE" } }, select: { id: true } });
  return rows.map((r) => r.id);
}
const personSelect = { id: true, username: true, profile: { select: { fullName: true } } } as const;
const personName = (u?: { username: string; profile: { fullName: string } | null } | null) => u ? u.profile?.fullName || u.username : null;

export async function listItems(actor: Actor, includeArchived = false) {
  requireManager(actor);
  const items = await prisma.supplyItem.findMany({ where: includeArchived ? {} : { archivedAt: null }, orderBy: [{ category: "asc" }, { name: "asc" }, { size: "asc" }] });
  return items.map((i) => ({ ...i, lowStock: !i.archivedAt && i.quantity <= i.minQuantity && i.minQuantity > 0, outOfStock: !i.archivedAt && i.quantity === 0 }));
}

export async function createItem(actor: Actor, input: z.infer<typeof createItemSchema>) {
  requireManager(actor);
  return serializable(async (tx) => {
    const { initialQuantity, ...data } = input;
    const item = await tx.supplyItem.create({ data: { ...data, size: data.size || null, location: data.location || null, notes: data.notes || null, quantity: initialQuantity } });
    if (initialQuantity > 0) await tx.supplyMovement.create({ data: { itemId: item.id, type: "IN", quantity: initialQuantity, balanceAfter: initialQuantity, reason: "Alta inicial", createdByUserId: actor.userId } });
    await tx.auditLog.create({ data: { actorUserId: actor.userId, action: "SUPPLY_ITEM_CREATED", entityType: "SupplyItem", entityId: item.id, metadata: { name: item.name, category: item.category, size: item.size, initialQuantity } } });
    return item;
  });
}

export async function updateItem(actor: Actor, id: string, input: z.infer<typeof updateItemSchema>) {
  requireManager(actor);
  return serializable(async (tx) => {
    const { revision, ...data } = input;
    const changed = await tx.supplyItem.updateMany({ where: { id, revision, archivedAt: null }, data: { ...data, size: data.size || null, location: data.location || null, notes: data.notes || null, revision: { increment: 1 } } });
    if (!changed.count) throw new OperationError(409, "El artículo cambió o fue dado de baja. Actualizá la pantalla");
    await tx.auditLog.create({ data: { actorUserId: actor.userId, action: "SUPPLY_ITEM_UPDATED", entityType: "SupplyItem", entityId: id, metadata: data } });
    return tx.supplyItem.findUniqueOrThrow({ where: { id } });
  });
}

export async function archiveItem(actor: Actor, id: string, reason: string) {
  requireManager(actor);
  return serializable(async (tx) => {
    const item = await tx.supplyItem.findFirst({ where: { id, archivedAt: null } });
    if (!item) throw new OperationError(404, "Artículo no encontrado");
    await tx.supplyItem.update({ where: { id }, data: { archivedAt: new Date(), revision: { increment: 1 } } });
    await tx.auditLog.create({ data: { actorUserId: actor.userId, action: "SUPPLY_ITEM_ARCHIVED", entityType: "SupplyItem", entityId: id, metadata: { name: item.name, quantity: item.quantity, reason } } });
    return { archived: true };
  });
}

/** Mueve stock con bloqueo de fila: nunca queda negativo y cada movimiento guarda el saldo resultante. */
async function applyMovement(tx: Prisma.TransactionClient, actor: Actor, itemId: string, input: z.infer<typeof movementSchema>, requestId?: string) {
  await lockRow(tx, "SupplyItem", itemId);
  const item = await tx.supplyItem.findFirst({ where: { id: itemId, archivedAt: null } });
  if (!item) throw new OperationError(404, "Artículo no encontrado o dado de baja");
  if (input.assignedUserId && !await tx.user.findFirst({ where: { id: input.assignedUserId, deletedAt: null }, select: { id: true } })) throw new OperationError(400, "Persona no encontrada");
  if (input.vehicleId && !await tx.vehicle.findUnique({ where: { id: input.vehicleId }, select: { id: true } })) throw new OperationError(400, "Móvil no encontrado");
  const balance = input.type === "IN" ? item.quantity + input.quantity : input.type === "ADJUST" ? input.quantity : item.quantity - input.quantity;
  if (balance < 0) throw new OperationError(409, `No alcanza el stock: hay ${item.quantity} ${item.unit}`);
  await tx.supplyItem.update({ where: { id: itemId }, data: { quantity: balance, revision: { increment: 1 } } });
  const movement = await tx.supplyMovement.create({ data: { itemId, type: input.type, quantity: input.type === "ADJUST" ? Math.abs(balance - item.quantity) : input.quantity, balanceAfter: balance, reason: input.reason, assignedUserId: input.assignedUserId || null, vehicleId: input.vehicleId || null, requestId: requestId || null, createdByUserId: actor.userId } });
  await tx.auditLog.create({ data: { actorUserId: actor.userId, action: `SUPPLY_${input.type}`, entityType: "SupplyItem", entityId: itemId, metadata: { before: item.quantity, after: balance, quantity: input.quantity, reason: input.reason, assignedUserId: input.assignedUserId || null, vehicleId: input.vehicleId || null, requestId: requestId || null } } });
  // Aviso de faltante: al cruzar el minimo hacia abajo se avisa a los encargados.
  if (item.minQuantity > 0 && item.quantity > item.minQuantity && balance <= item.minQuantity) {
    await notify(tx, (await managerIds(tx)).filter((id) => id !== actor.userId), `Stock bajo: ${item.name}${item.size ? ` (${item.size})` : ""}`, "/supplies", `Quedan ${balance} ${item.unit}; el mínimo es ${item.minQuantity}.`);
  }
  return movement;
}

export async function recordMovement(actor: Actor, itemId: string, input: z.infer<typeof movementSchema>) {
  requireManager(actor);
  return serializable((tx) => applyMovement(tx, actor, itemId, input));
}

export async function listMovements(actor: Actor, itemId?: string) {
  requireManager(actor);
  const rows = await prisma.supplyMovement.findMany({ where: itemId ? { itemId } : {}, orderBy: { createdAt: "desc" }, take: 100, include: { item: { select: { name: true, size: true, unit: true } } } });
  const ids = [...new Set(rows.flatMap((r) => [r.createdByUserId, r.assignedUserId].filter(Boolean) as string[]))];
  const vehicleIds = [...new Set(rows.map((r) => r.vehicleId).filter(Boolean) as string[])];
  const [people, vehicles] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: ids } }, select: personSelect }),
    prisma.vehicle.findMany({ where: { id: { in: vehicleIds } }, select: { id: true, unitNumber: true } }),
  ]);
  const who = (id: string | null) => personName(people.find((p) => p.id === id));
  return rows.map((r) => ({ ...r, createdBy: who(r.createdByUserId), assignedTo: who(r.assignedUserId), vehicle: vehicles.find((v) => v.id === r.vehicleId)?.unitNumber ?? null }));
}

export async function createRequest(actor: Actor, input: z.infer<typeof requestSchema>) {
  if (!canRequestMaterials(actor)) throw new OperationError(403, "Los pedidos de materiales los hacen oficiales, sub oficiales, administración o la guardia. Para vestimenta personal usá «Pedir equipo»");
  return serializable(async (tx) => {
    let vehicleLabel: string | null = null;
    if (input.destination === "VEHICLE") {
      const vehicle = await tx.vehicle.findUnique({ where: { id: input.vehicleId! }, select: { unitNumber: true } });
      if (!vehicle) throw new OperationError(400, "Móvil no encontrado");
      vehicleLabel = vehicle.unitNumber;
    }
    const row = await tx.materialRequest.create({ data: { title: input.title, details: input.details || null, destination: input.destination, vehicleId: input.destination === "VEHICLE" ? input.vehicleId! : null, quantity: input.quantity, priority: input.priority, requestedByUserId: actor.userId } });
    await tx.auditLog.create({ data: { actorUserId: actor.userId, action: "MATERIAL_REQUEST_CREATED", entityType: "MaterialRequest", entityId: row.id, metadata: { title: row.title, destination: row.destination, vehicle: vehicleLabel, quantity: row.quantity, priority: row.priority } } });
    await notify(tx, (await managerIds(tx)).filter((id) => id !== actor.userId), `${input.priority === "URGENT" ? "URGENTE · " : ""}Pedido de material: ${input.title}`, "/supplies?tab=requests", vehicleLabel ? `Para el móvil ${vehicleLabel}. Cantidad: ${input.quantity}.` : `Para el cuartel. Cantidad: ${input.quantity}.`);
    return row;
  });
}

export async function listRequests(actor: Actor, scope: "all" | "mine" | "open") {
  const manager = isSupplyManager(actor);
  if (!manager && !canRequestMaterials(actor)) throw new OperationError(403, "Sin acceso a pedidos de materiales");
  const where: Prisma.MaterialRequestWhereInput = {
    ...(!manager || scope === "mine" ? { requestedByUserId: actor.userId } : {}),
    ...(scope === "open" ? { status: { in: ["PENDING", "APPROVED", "ORDERED"] } } : {}),
  };
  const rows = await prisma.materialRequest.findMany({ where, orderBy: [{ createdAt: "desc" }], take: 200, include: { supplyItem: { select: { id: true, name: true, size: true, quantity: true, unit: true } } } });
  const ids = [...new Set(rows.flatMap((r) => [r.requestedByUserId, r.handledByUserId].filter(Boolean) as string[]))];
  const [people, vehicles] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: ids } }, select: personSelect }),
    prisma.vehicle.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.vehicleId).filter(Boolean) as string[])] } }, select: { id: true, unitNumber: true } }),
  ]);
  const who = (id: string | null) => personName(people.find((p) => p.id === id));
  return rows.map((r) => ({ ...r, requestedBy: who(r.requestedByUserId), handledBy: who(r.handledByUserId), vehicle: vehicles.find((v) => v.id === r.vehicleId)?.unitNumber ?? null, canCancel: r.requestedByUserId === actor.userId && r.status === "PENDING" }));
}

const NEXT: Record<string, string[]> = { PENDING: ["APPROVED", "ORDERED", "DELIVERED", "REJECTED"], APPROVED: ["ORDERED", "DELIVERED", "REJECTED"], ORDERED: ["DELIVERED", "REJECTED"] };
const STATUS_LABEL: Record<string, string> = { APPROVED: "aprobado", ORDERED: "encargado al proveedor", DELIVERED: "entregado", REJECTED: "rechazado" };

/** El encargado avanza el pedido. Al entregarlo desde el deposito descuenta el stock en el mismo paso. */
export async function decideRequest(actor: Actor, id: string, input: z.infer<typeof decideSchema>) {
  requireManager(actor);
  return serializable(async (tx) => {
    await lockRow(tx, "MaterialRequest", id);
    const row = await tx.materialRequest.findUnique({ where: { id } });
    if (!row) throw new OperationError(404, "Pedido no encontrado");
    if (row.revision !== input.revision) throw new OperationError(409, "El pedido cambió. Actualizá la pantalla");
    if (!NEXT[row.status]?.includes(input.status)) throw new OperationError(409, "Ese cambio de estado no corresponde");
    if (input.status === "DELIVERED" && input.supplyItemId) {
      await applyMovement(tx, actor, input.supplyItemId, { type: row.vehicleId ? "ASSIGN" : "OUT", quantity: row.quantity, reason: `Entrega del pedido: ${row.title}`.slice(0, 500), vehicleId: row.vehicleId }, row.id);
    }
    const updated = await tx.materialRequest.update({ where: { id }, data: { status: input.status, handlerNotes: input.notes || row.handlerNotes, handledByUserId: actor.userId, handledAt: new Date(), supplyItemId: input.supplyItemId || row.supplyItemId, revision: { increment: 1 } } });
    await tx.auditLog.create({ data: { actorUserId: actor.userId, action: `MATERIAL_REQUEST_${input.status}`, entityType: "MaterialRequest", entityId: id, metadata: { before: row.status, after: input.status, notes: input.notes || null, supplyItemId: input.supplyItemId || null } } });
    if (row.requestedByUserId !== actor.userId) await notify(tx, [row.requestedByUserId], `Tu pedido «${row.title}» fue ${STATUS_LABEL[input.status]}`, "/supplies?tab=requests", input.notes || undefined);
    return updated;
  });
}

export async function cancelRequest(actor: Actor, id: string) {
  return serializable(async (tx) => {
    const row = await tx.materialRequest.findUnique({ where: { id } });
    if (!row || row.requestedByUserId !== actor.userId) throw new OperationError(404, "Pedido no encontrado");
    if (row.status !== "PENDING") throw new OperationError(409, "Solo se cancela un pedido que todavía no se atendió");
    await tx.materialRequest.update({ where: { id }, data: { status: "CANCELLED", revision: { increment: 1 } } });
    await tx.auditLog.create({ data: { actorUserId: actor.userId, action: "MATERIAL_REQUEST_CANCELLED", entityType: "MaterialRequest", entityId: id } });
    return { cancelled: true };
  });
}

/** Tablero del encargado: faltantes, pedidos abiertos (materiales y vestimenta) y ultimos movimientos. */
export async function supplySummary(actor: Actor) {
  requireManager(actor);
  const [items, openRequests, clothing, recent] = await Promise.all([
    prisma.supplyItem.findMany({ where: { archivedAt: null }, select: { id: true, name: true, size: true, unit: true, quantity: true, minQuantity: true, category: true } }),
    prisma.materialRequest.count({ where: { status: { in: ["PENDING", "APPROVED", "ORDERED"] } } }),
    prisma.personalEquipmentRequest.count({ where: { status: { in: ["PENDING", "APPROVED"] } } }),
    prisma.supplyMovement.count({ where: { createdAt: { gt: new Date(Date.now() - 30 * 86_400_000) } } }),
  ]);
  const low = items.filter((i) => i.minQuantity > 0 && i.quantity <= i.minQuantity);
  return { items: items.length, units: items.reduce((s, i) => s + i.quantity, 0), lowStock: low.sort((a, b) => a.quantity - b.quantity).slice(0, 20), outOfStock: items.filter((i) => i.quantity === 0).length, openMaterialRequests: openRequests, openClothingRequests: clothing, movementsLast30Days: recent };
}

export async function supplyOptions(actor: Actor) {
  if (!isSupplyManager(actor) && !canRequestMaterials(actor)) throw new OperationError(403, "Sin acceso");
  const [vehicles, people] = await Promise.all([
    prisma.vehicle.findMany({ select: { id: true, unitNumber: true, asset: { select: { name: true } } }, orderBy: { unitNumber: "asc" } }),
    isSupplyManager(actor) ? prisma.user.findMany({ where: { isActive: true, deletedAt: null, isPendingApproval: false, guardForUserId: null }, select: personSelect, orderBy: { username: "asc" } }) : Promise.resolve([]),
  ]);
  return { vehicles: vehicles.map((v) => ({ id: v.id, label: `Móvil ${v.unitNumber}${v.asset?.name ? ` · ${v.asset.name}` : ""}` })), people: people.map((p) => ({ id: p.id, name: personName(p) })), manager: isSupplyManager(actor), canRequest: canRequestMaterials(actor) };
}
