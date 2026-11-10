import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../config/prisma";
import { PUBLIC_USER_SELECT } from "../../utils/public-user";
import { serializable } from "../../utils/transaction";
import { OperationError, isDutyManager } from "../operations/operations.schemas";
import { Actor, assertPast } from "../work/work.schemas";
import { activePeople } from "../work/work.service";
import { fleetQuery, fuelSchema, waterSchema, waterPaymentSchema } from "./fleet.schemas";
import {financeAccess} from "../../utils/finance-access";
const fuelInclude = { asset: { select: { id: true, name: true } }, createdBy: { select: PUBLIC_USER_SELECT } };
const waterInclude = { asset: { select: { id: true, name: true } }, leader: { select: PUBLIC_USER_SELECT }, createdBy: { select: PUBLIC_USER_SELECT }, crew: { include: { user: { select: PUBLIC_USER_SELECT } }, orderBy: { userId: "asc" as const } } };
const digest = (data: unknown) => createHash("sha256").update(JSON.stringify(data)).digest("hex");
function manager(actor: Actor) { if (!isDutyManager(actor.role)) throw new OperationError(403, "Solo responsables pueden registrar movimientos de flota"); }
async function vehicle(tx: Prisma.TransactionClient, assetId: string, allowArchived = false) {
  const asset = await tx.asset.findFirst({ where: { id: assetId, assetType: "VEHICLE", ...(!allowArchived ? {deletedAt: null} : {}), vehicle: { isNot: null } }, select: { id: true } });
  if (!asset) throw new OperationError(400, "Seleccione un movil vigente con ficha vehicular");
}
function monthRange(month?: string) {
  if (!month) return undefined;
  const [year, m] = month.split("-").map(Number);
  return { gte: new Date(`${month}-01T00:00:00-03:00`), lt: new Date(Date.UTC(year!, m!, 1, 3)) };
}
export async function listFuel(query: z.infer<typeof fleetQuery>, actor: Actor) {
  // Financial documents are not part of the public operational roster.
  manager(actor);
  const where: Prisma.FuelRecordWhereInput = { ...(query.assetId ? { assetId: query.assetId } : {}), ...(query.month ? { occurredAt: monthRange(query.month) } : {}), ...(query.q ? { asset: { name: { contains: query.q, mode: "insensitive" } } } : {}) };
  return prisma.$transaction(async (tx) => {
    const [items, total, totals, byVehicle] = await Promise.all([
      tx.fuelRecord.findMany({ where, include: fuelInclude, orderBy: [{ occurredAt: "desc" }, { id: "desc" }], take: 30, skip: (query.page - 1) * 30 }),
      tx.fuelRecord.count({ where }),
      tx.fuelRecord.aggregate({ where: { ...where, voidedAt: null }, _sum: { volumeMilliliters: true, costCents: true }, _count: true }),
      tx.fuelRecord.groupBy({ by: ["assetId"], where: { ...where, voidedAt: null }, _sum: { volumeMilliliters: true, costCents: true }, _count: true }),
    ]);
    return { items: items.map(({ requestHash, ...item }) => item), total, page: query.page, pageSize: 30, totals, byVehicle };
  }, { isolationLevel: "RepeatableRead" });
}
export async function recordFuel(input: z.infer<typeof fuelSchema>, actor: Actor) {
  manager(actor);
  return serializable(tx=>recordFuelIn(tx,input,actor));
}
export async function recordFuelIn(tx:Prisma.TransactionClient,input:z.infer<typeof fuelSchema>,actor:Actor,originalAssetId?:string){
  manager(actor);
  const occurredAt = assertPast(input.occurredAt), requestHash = digest(input);
    const previous = await tx.fuelRecord.findUnique({ where: { operationKey: input.operationKey } });
    if (previous) {
      if (previous.createdByUserId !== actor.userId || previous.requestHash !== requestHash) throw new OperationError(409, "La clave de operacion ya fue utilizada");
      const { requestHash: _, ...record } = previous; return record;
    }
    await vehicle(tx, input.assetId,originalAssetId===input.assetId);
    if (input.odometer != null) {
      const inconsistent = await tx.fuelRecord.findFirst({ where: { assetId: input.assetId, voidedAt: null, OR: [{ occurredAt: { lte: occurredAt }, odometer: { gt: input.odometer } }, { occurredAt: { gte: occurredAt }, odometer: { lt: input.odometer } }] } });
      if (inconsistent) throw new OperationError(409, "El odometro contradice otra carga registrada");
    }
    const { liters, ...fields } = input;
    const record = await tx.fuelRecord.create({ data: { ...fields, occurredAt, volumeMilliliters: liters!, requestHash, createdByUserId: actor.userId } });
    await tx.auditLog.create({ data: { actorUserId: actor.userId, action: "FUEL_CREATED", entityType: "FuelRecord", entityId: record.id } });
    const { requestHash: _, ...result } = record; return result;
}
export async function voidFuel(id: string, notes: string, actor: Actor) {
  manager(actor);
  return serializable(async (tx) => {
    const changed = await tx.fuelRecord.updateMany({ where: { id, voidedAt: null }, data: { voidedAt: new Date(), voidReason: notes } });
    if (!changed.count) throw new OperationError(409, "Carga inexistente o ya anulada");
    await tx.auditLog.create({ data: { actorUserId: actor.userId, action: "FUEL_VOIDED", entityType: "FuelRecord", entityId: id, metadata: { reason: notes } } });
    return { message: "Carga anulada; registro original conservado" };
  });
}
export async function listWater(query: z.infer<typeof fleetQuery>, actor: Actor) {
  manager(actor);
  const where: Prisma.WaterTripWhereInput = { ...(!isDutyManager(actor.role) ? { crew: { some: { userId: actor.userId } } } : {}), ...(query.assetId ? { assetId: query.assetId } : {}), ...(query.month ? { departedAt: monthRange(query.month) } : {}), ...(query.q ? { OR: [{ customer: { contains: query.q, mode: "insensitive" } }, { destination: { contains: query.q, mode: "insensitive" } }] } : {}) };
  return prisma.$transaction(async (tx) => {
    const items = await tx.waterTrip.findMany({ where, include: waterInclude, orderBy: [{ departedAt: "desc" }, { id: "desc" }], take: 30, skip: (query.page - 1) * 30 });
    const safe = items.map(({ requestHash, ...item }) => isDutyManager(actor.role) ? item : { ...item, customer: "Reservado a responsables", destination: "Reservado a responsables", chargeCents: null, clientPaidAt: null, notes: "", crew: item.crew.filter((m) => m.userId === actor.userId) });
    return { items: safe, total: await tx.waterTrip.count({ where }), page: query.page, pageSize: 30 };
  }, { isolationLevel: "RepeatableRead" });
}
export async function recordWater(input: z.infer<typeof waterSchema>, actor: Actor) {
  manager(actor);
  return serializable(tx=>recordWaterIn(tx,input,actor));
}
export async function recordWaterIn(tx:Prisma.TransactionClient,input:z.infer<typeof waterSchema>,actor:Actor,original?:{assetId:string;userIds:string[]}){
  manager(actor);
  const departedAt = assertPast(input.departedAt), returnedAt = assertPast(input.returnedAt), requestHash = digest(input);
    const previous = await tx.waterTrip.findUnique({ where: { operationKey: input.operationKey } });
    if (previous) {
      if (previous.createdByUserId !== actor.userId || previous.requestHash !== requestHash) throw new OperationError(409, "La clave de operacion ya fue utilizada");
      const { requestHash: _, ...record } = previous; return record;
    }
    await vehicle(tx, input.assetId,original?.assetId===input.assetId);
    await activePeople(tx, input.crew.map((m) => m.userId).filter(id=>!original?.userIds.includes(id)));
    if(await tx.missionMovement.findFirst({where:{assetId:input.assetId,departedAt:{lt:returnedAt},OR:[{returnedAt:null},{returnedAt:{gt:departedAt}}]}}))throw new OperationError(409,"El viaje se superpone con una salida de emergencia");
    const overlap = await tx.waterTrip.findFirst({ where: { assetId: input.assetId, voidedAt: null, departedAt: { lt: returnedAt }, returnedAt: { gt: departedAt } } });
    if (overlap) throw new OperationError(409, "El movil ya tiene un viaje en ese horario");
    const crewIds=input.crew.map(m=>m.userId);
    if(await tx.waterTrip.findFirst({where:{voidedAt:null,departedAt:{lt:returnedAt},returnedAt:{gt:departedAt},crew:{some:{userId:{in:crewIds}}}}}))throw new OperationError(409,"Hay personal con otro viaje en ese horario");
    if(await tx.missionCrew.findFirst({where:{userId:{in:crewIds},movement:{departedAt:{lt:returnedAt},OR:[{returnedAt:null},{returnedAt:{gt:departedAt}}]}}}))throw new OperationError(409,"Hay personal desplegado a una emergencia en ese horario");
    const mileage = await tx.waterTrip.findFirst({ where: { assetId: input.assetId, voidedAt: null, OR: [{ returnedAt: { lte: departedAt }, endOdometer: { gt: input.startOdometer } }, { departedAt: { gte: returnedAt }, startOdometer: { lt: input.endOdometer } }] } });
    if (mileage) throw new OperationError(409, "El kilometraje contradice otro viaje");
    const { crew, ...fields } = input;
    const trip = await tx.waterTrip.create({ data: { ...fields, departedAt, returnedAt, requestHash, createdByUserId: actor.userId, crew: { create: crew } } });
    await tx.auditLog.create({ data: { actorUserId: actor.userId, action: "WATER_TRIP_CREATED", entityType: "WaterTrip", entityId: trip.id } });
    const { requestHash: _, ...result } = trip; return result;
}
export async function settleWater(id: string, input: z.infer<typeof waterPaymentSchema>, actor: Actor) {
  manager(actor);
  if(!(await financeAccess(actor.userId,actor.role)).canManage)throw new OperationError(403,"Solo administración o el jefe financiero registra cobros y pagos");
  if(input.kind==="CREW"&&input.userId===actor.userId)throw new OperationError(403,"Otra persona autorizada debe registrar el pago o reversión propio");
  return serializable(async (tx) => {
    const trip = await tx.waterTrip.findUnique({ where: { id }, include: { crew: true } });
    if (!trip || trip.voidedAt) throw new OperationError(409, "Viaje inexistente o anulado");
    if(input.kind==="CREW"&&!input.reverse&&!trip.earningsApprovedAt)throw new OperationError(409,"Las ganancias necesitan revisión financiera independiente antes del pago");
    if (input.kind === "CLIENT" && (Boolean(trip.clientPaidAt) !== input.reverse || trip.chargeCents === 0)) throw new OperationError(409, "El cobro ya cambio de estado o no tiene importe");
    const member = trip.crew.find((m) => m.userId === input.userId);
    if (input.kind === "CREW" && (!member || Boolean(member.paidAt) !== input.reverse || member.compensationCents === 0)) throw new OperationError(409, "El pago ya cambio de estado o no tiene importe");
    const paidAt = input.reverse ? null : new Date();
    const changed = await tx.waterTrip.updateMany({ where: { id, revision: input.revision, voidedAt: null }, data: { revision: { increment: 1 }, ...(input.kind === "CLIENT" ? { clientPaidAt: paidAt } : {}) } });
    if (!changed.count) throw new OperationError(409, "El viaje cambio. Actualice antes de registrar el pago");
    if (input.kind === "CREW") await tx.waterTripMember.update({ where: { tripId_userId: { tripId: id, userId: input.userId! } }, data: { paidAt } });
    await tx.auditLog.create({ data: { actorUserId: actor.userId, action: `WATER_${input.kind}_${input.reverse ? "REVERSED" : "SETTLED"}`, entityType: "WaterTrip", entityId: id, metadata: { userId: input.userId ?? null, notes: input.notes } } });
    return { message: "Constancia registrada. No se realizo ninguna transferencia de dinero." };
  });
}
export async function voidWater(id: string, revision: number, notes: string, actor: Actor) {
  manager(actor);
  return serializable(async (tx) => {
    const current=await tx.waterTrip.findUnique({where:{id},select:{earningsApprovedAt:true}});if(current?.earningsApprovedAt&&!(await financeAccess(actor.userId,actor.role)).canManage)throw new OperationError(403,"Solo acceso financiero puede anular una deuda reconocida");
    const changed = await tx.waterTrip.updateMany({ where: { id, revision, voidedAt: null, clientPaidAt: null, crew: { none: { paidAt: { not: null } } } }, data: { voidedAt: new Date(), voidReason: notes, revision: { increment: 1 } } });
    if (!changed.count) throw new OperationError(409, "El viaje cambio o tiene cobros/pagos registrados; no se puede anular");
    await tx.auditLog.create({ data: { actorUserId: actor.userId, action: "WATER_TRIP_VOIDED", entityType: "WaterTrip", entityId: id, metadata: { reason: notes } } });
    return { message: "Viaje anulado; historial conservado" };
  });
}
