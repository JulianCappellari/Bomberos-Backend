import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../config/prisma";
import { serializable } from "../../utils/transaction";
import { stationDate } from "../../utils/station-time";
import { PUBLIC_USER_SELECT } from "../../utils/public-user";
import { OperationError } from "../operations/operations.schemas";
import { filterRemaining, fillWindow, hydroCurrent } from "./air.rules";
import { airCylinderSchema, airCompressorSchema, airHydroSchema, airMoveSchema, airPressureSchema, airStatusSchema, airFilterSchema, airFillSchema, airListSchema } from "./air.schemas";

const blocked = { blocksOperation: true, status: { in: ["OPEN", "IN_PROGRESS"] as ("OPEN" | "IN_PROGRESS")[] } };
const asset = { select: { id: true, name: true, status: true, deletedAt: true, maintenanceJobs: { where: blocked, select: { id: true } } } };
const cylinderInclude = { asset, vehicle: { select: { id: true, name: true } }, hydroTests: { take: 1, orderBy: [{ testedOn: "desc" as const }, { createdAt: "desc" as const }, { id: "desc" as const }], include: { registeredBy: { select: PUBLIC_USER_SELECT } } } };
const compressorInclude = { asset, filterChanges: { take: 3, orderBy: [{ changedAt: "desc" as const }, { id: "desc" as const }], include: { changedBy: { select: PUBLIC_USER_SELECT } } } };
const fillInclude = { compressor: { select: { code: true } }, operator: { select: PUBLIC_USER_SELECT }, createdBy: { select: PUBLIC_USER_SELECT }, helpers: { include: { user: { select: PUBLIC_USER_SELECT } } }, items: true };
type Tx = Prisma.TransactionClient;
async function audit(tx: Tx, userId: string, action: string, entityId: string, metadata: Prisma.InputJsonObject = {}) {
  await tx.auditLog.create({ data: { actorUserId: userId, action, entityType: "AirEquipment", entityId, metadata } });
}
async function cylinder(tx: Tx, id: string) {
  const row = await tx.airCylinder.findUnique({ where: { id }, include: cylinderInclude });
  if (!row || row.asset.deletedAt) throw new OperationError(404, "Cilindro no encontrado");
  return row;
}
async function compressor(tx: Tx, id: string) {
  const row = await tx.airCompressor.findUnique({ where: { id }, include: compressorInclude });
  if (!row || row.asset.deletedAt) throw new OperationError(404, "Compresor no encontrado");
  return row;
}
async function claim(tx: Tx, kind: "cylinder" | "compressor", id: string, revision: number) {
  const where = { id, revision, retiredAt: null };
  const row = kind === "cylinder" ? await tx.airCylinder.updateMany({ where, data: { revision: { increment: 1 }, lastEventAt: new Date() } }) : await tx.airCompressor.updateMany({ where, data: { revision: { increment: 1 } } });
  if (!row.count) throw new OperationError(409, "El equipo cambio o fue dado de baja. Recargue antes de continuar.");
}
async function vehicleExists(tx: Tx, id?: string | null) {
  if (id && !await tx.asset.findFirst({ where: { id, assetType: "VEHICLE", deletedAt: null }, select: { id: true } })) throw new OperationError(400, "El movil seleccionado no existe");
}
function cylinderReasons(row: Awaited<ReturnType<typeof cylinder>>) {
  return [row.retiredAt && "Dado de baja", row.asset.status !== "OPERATIONAL" && "Requiere revision de estado", row.asset.maintenanceJobs.length > 0 && "Mantenimiento bloqueante", !hydroCurrent(row.hydroTests[0], stationDate()) && "Prueba hidraulica ausente, rechazada o vencida", !row.reviewedAt && "Sin revision registrada"].filter(Boolean) as string[];
}
function compressorReasons(row: Awaited<ReturnType<typeof compressor>>) {
  return [row.retiredAt && "Dado de baja", row.asset.status !== "OPERATIONAL" && "Requiere revision de estado", row.asset.maintenanceJobs.length > 0 && "Mantenimiento bloqueante", !row.reviewedAt && "Sin revision registrada", (!row.airQualityReference || !row.airQualityValidUntil || row.airQualityValidUntil.toISOString().slice(0, 10) < stationDate()) && "Registro de calidad de aire ausente o vencido", filterRemaining(row.totalRunMinutes, row.filterBaselineMinutes, row.filterLifeMinutes) === 0 && "Filtro agotado"].filter(Boolean) as string[];
}
export async function listAir(kind: "cylinders" | "compressors", filters: z.infer<typeof airListSchema>) {
  const where = { retiredAt: filters.retired === "true" ? { not: null } : null, asset: { deletedAt: null }, ...(filters.q ? { OR: [{ code: { contains: filters.q, mode: "insensitive" as const } }, { asset: { name: { contains: filters.q, mode: "insensitive" as const } } }] } : {}) };
  if (kind === "cylinders") {
    const [rows, total] = await prisma.$transaction([prisma.airCylinder.findMany({ where, include: cylinderInclude, orderBy: { code: "asc" }, skip: (filters.page - 1) * 30, take: 30 }), prisma.airCylinder.count({ where })], { isolationLevel: "RepeatableRead" });
    return { items: rows.map((row) => ({ ...row, blockingReasons: cylinderReasons(row) })), total, page: filters.page, pageSize: 30 };
  }
  const [rows, total] = await prisma.$transaction([prisma.airCompressor.findMany({ where, include: compressorInclude, orderBy: { code: "asc" }, skip: (filters.page - 1) * 30, take: 30 }), prisma.airCompressor.count({ where })], { isolationLevel: "RepeatableRead" });
  return { items: rows.map((row) => ({ ...row, remainingFilterMinutes: filterRemaining(row.totalRunMinutes, row.filterBaselineMinutes, row.filterLifeMinutes), blockingReasons: compressorReasons(row) })), total, page: filters.page, pageSize: 30 };
}
export async function listAirHistory(kind: "fills" | "tests" | "filters", filters: z.infer<typeof airListSchema>) {
  const paging = { skip: (filters.page - 1) * 30, take: 30 };
  if (kind === "fills") {
    const where = { ...(filters.compressorId ? { compressorId: filters.compressorId } : {}), ...(filters.cylinderId ? { items: { some: { cylinderId: filters.cylinderId } } } : {}) };
    const [items, total] = await prisma.$transaction([prisma.airFill.findMany({ where, include: fillInclude, orderBy: [{ startedAt: "desc" }, { id: "desc" }], ...paging }), prisma.airFill.count({ where })]);
    return { items, total, page: filters.page, pageSize: 30 };
  }
  if (kind === "tests") {
    const where = { cylinderId: filters.cylinderId };
    const [items, total] = await prisma.$transaction([prisma.airHydroTest.findMany({ where, include: { registeredBy: { select: PUBLIC_USER_SELECT } }, orderBy: [{ testedOn: "desc" }, { createdAt: "desc" }, { id: "desc" }], ...paging }), prisma.airHydroTest.count({ where })]);
    return { items, total, page: filters.page, pageSize: 30 };
  }
  const where = { compressorId: filters.compressorId };
  const [items, total] = await prisma.$transaction([prisma.airFilterChange.findMany({ where, include: { changedBy: { select: PUBLIC_USER_SELECT } }, orderBy: [{ changedAt: "desc" }, { id: "desc" }], ...paging }), prisma.airFilterChange.count({ where })]);
  return { items, total, page: filters.page, pageSize: 30 };
}
export async function createAirCylinder(input: z.infer<typeof airCylinderSchema>, userId: string) {
  return serializable(async (tx) => {
    await vehicleExists(tx, input.vehicleAssetId);
    const { name, vehicleAssetId, ...data } = input;
    const row = await tx.airCylinder.create({ data: { ...data, ...(vehicleAssetId ? { vehicle: { connect: { id: vehicleAssetId } } } : {}), externalOwner: data.externalOwner || null, asset: { create: { name, assetType: "PPE", status: "MAINTENANCE" } } } });
    await audit(tx, userId, "AIR_CYLINDER_CREATED", row.id, { code: row.code }); return row;
  });
}
export async function createAirCompressor(input: z.infer<typeof airCompressorSchema>, userId: string) {
  if (new Date(input.filterInstalledAt) > new Date()) throw new OperationError(400, "La instalacion del filtro no puede ser futura");
  return serializable(async (tx) => {
    const row = await tx.airCompressor.create({ data: {
      code: input.code, maxPressureBar: input.maxPressureBar, filterLifeMinutes: input.filterLifeMinutes, filterReference: input.filterReference, filterInstalledAt: new Date(input.filterInstalledAt),
      totalRunMinutes: input.initialTotalMinutes, filterBaselineMinutes: input.initialTotalMinutes - input.initialFilterUsedMinutes,
      asset: { create: { name: input.name, assetType: "OTHER", status: "MAINTENANCE" } },
    } });
    await audit(tx, userId, "AIR_COMPRESSOR_CREATED", row.id, { initialTotalMinutes: row.totalRunMinutes, initialFilterUsedMinutes: input.initialFilterUsedMinutes }); return row;
  });
}
export async function recordHydro(id: string, input: z.infer<typeof airHydroSchema>, userId: string) {
  return serializable(async (tx) => {
    const row = await cylinder(tx, id);
    if (input.testedOn > stationDate() || row.hydroTests[0] && input.testedOn < row.hydroTests[0].testedOn.toISOString().slice(0, 10)) throw new OperationError(400, "La fecha no puede ser futura ni anterior a la ultima prueba registrada");
    await claim(tx, "cylinder", id, input.revision);
    const test = await tx.airHydroTest.create({ data: { cylinderId: id, result: input.result, testedOn: new Date(input.testedOn + "T00:00:00Z"), validUntil: input.validUntil ? new Date(input.validUntil + "T00:00:00Z") : null, certificateReference: input.certificateReference, notes: input.notes, registeredByUserId: userId } });
    await tx.airCylinder.update({ where: { id }, data: { reviewedAt: null } });
    await tx.asset.update({ where: { id: row.assetId }, data: { status: input.result === "FAIL" || row.asset.status === "OUT_OF_SERVICE" ? "OUT_OF_SERVICE" : "MAINTENANCE" } });
    await audit(tx, userId, "AIR_HYDRO_REGISTERED", id, { testId: test.id, result: input.result }); return test;
  });
}
export async function updateAirStatus(kind: "cylinder" | "compressor", id: string, input: z.infer<typeof airStatusSchema>, userId: string) {
  return serializable(async (tx) => {
    const row = kind === "cylinder" ? await cylinder(tx, id) : await compressor(tx, id);
    if (input.status === "OPERATIONAL") {
      if (row.asset.maintenanceJobs.length) throw new OperationError(409, "Cierre el mantenimiento bloqueante antes de registrar la revision");
      if (kind === "cylinder") {
        if (!hydroCurrent((row as Awaited<ReturnType<typeof cylinder>>).hydroTests[0], stationDate())) throw new OperationError(409, "Se requiere una prueba hidraulica aprobada y vigente");
      } else {
        const comp = row as Awaited<ReturnType<typeof compressor>>;
        if (!input.airQualityReference || !input.airQualityValidUntil || input.airQualityValidUntil < stationDate()) throw new OperationError(400, "Ingrese referencia y vigencia del control de calidad de aire");
        if (!filterRemaining(comp.totalRunMinutes, comp.filterBaselineMinutes, comp.filterLifeMinutes)) throw new OperationError(409, "El filtro esta agotado");
      }
    }
    await claim(tx, kind, id, input.revision);
    const reviewedAt = input.status === "OPERATIONAL" ? new Date() : null;
    if (kind === "cylinder") await tx.airCylinder.update({ where: { id }, data: { reviewedAt } });
    else await tx.airCompressor.update({ where: { id }, data: { reviewedAt, ...(input.status === "OPERATIONAL" ? { airQualityReference: input.airQualityReference, airQualityValidUntil: new Date(input.airQualityValidUntil! + "T00:00:00Z") } : {}) } });
    await tx.asset.update({ where: { id: row.assetId }, data: { status: input.status, lastCheckDate: reviewedAt || undefined } });
    await audit(tx, userId, "AIR_STATE_REVIEWED", id, { kind, status: input.status, notes: input.notes, airQualityReference: input.airQualityReference || null, airQualityValidUntil: input.airQualityValidUntil || null });
    return { message: "Revision de estado registrada" };
  });
}
export async function moveAirCylinder(id: string, input: z.infer<typeof airMoveSchema>, userId: string) {
  return serializable(async (tx) => {
    const row = await cylinder(tx, id); await vehicleExists(tx, input.vehicleAssetId); await claim(tx, "cylinder", id, input.revision);
    await tx.airCylinder.update({ where: { id }, data: { vehicleAssetId: input.vehicleAssetId } });
    await audit(tx, userId, "AIR_CYLINDER_MOVED", id, { from: row.vehicleAssetId, to: input.vehicleAssetId, notes: input.notes }); return { message: "Ubicacion actualizada" };
  });
}
export async function recordPressure(id: string, input: z.infer<typeof airPressureSchema>, userId: string) {
  return serializable(async (tx) => {
    const row = await cylinder(tx, id);
    if (input.pressureBar > row.ratedPressureBar) throw new OperationError(400, "La presion supera el limite nominal registrado");
    await claim(tx, "cylinder", id, input.revision);
    await tx.airCylinder.update({ where: { id }, data: { pressureBar: input.pressureBar } });
    await audit(tx, userId, "AIR_PRESSURE_MEASURED", id, { previousPressureBar: row.pressureBar, pressureBar: input.pressureBar, notes: input.notes }); return { message: "Medicion registrada; no modifica la habilitacion" };
  });
}
export async function changeAirFilter(id: string, input: z.infer<typeof airFilterSchema>, userId: string) {
  return serializable(async (tx) => {
    const row = await compressor(tx, id); await claim(tx, "compressor", id, input.revision);
    const change = await tx.airFilterChange.create({ data: { compressorId: id, totalMinutesSnapshot: row.totalRunMinutes, previousBaselineMinutes: row.filterBaselineMinutes, previousLifeMinutes: row.filterLifeMinutes, previousReference: row.filterReference, newLifeMinutes: input.filterLifeMinutes, newReference: input.filterReference, notes: input.notes, changedByUserId: userId } });
    await tx.airCompressor.update({ where: { id }, data: { filterBaselineMinutes: row.totalRunMinutes, filterLifeMinutes: input.filterLifeMinutes, filterReference: input.filterReference, filterInstalledAt: change.changedAt, reviewedAt: null, airQualityReference: null, airQualityValidUntil: null } });
    await tx.asset.update({ where: { id: row.assetId }, data: { status: row.asset.status === "OUT_OF_SERVICE" ? "OUT_OF_SERVICE" : "MAINTENANCE" } });
    await audit(tx, userId, "AIR_FILTER_CHANGED", id, { changeId: change.id, totalRunMinutes: row.totalRunMinutes }); return change;
  });
}
export async function retireAir(kind: "cylinder" | "compressor", id: string, revision: number, notes: string, userId: string) {
  return serializable(async (tx) => {
    const row = kind === "cylinder" ? await cylinder(tx, id) : await compressor(tx, id); await claim(tx, kind, id, revision);
    if (kind === "cylinder") await tx.airCylinder.update({ where: { id }, data: { retiredAt: new Date() } });
    else await tx.airCompressor.update({ where: { id }, data: { retiredAt: new Date() } });
    await tx.asset.update({ where: { id: row.assetId }, data: { status: "OUT_OF_SERVICE" } });
    await audit(tx, userId, "AIR_EQUIPMENT_RETIRED", id, { kind, notes }); return { message: "Baja registrada; historial conservado" };
  });
}
export async function recordAirFill(input: z.infer<typeof airFillSchema>, userId: string) {
  const hash = createHash("sha256").update(JSON.stringify({ ...input, helperUserIds: [...input.helperUserIds].sort(), items: [...input.items].sort((a, b) => a.cylinderId.localeCompare(b.cylinderId)) })).digest("hex");
  return serializable(async (tx) => {
    const replay = await tx.airFill.findUnique({ where: { operationKey: input.operationKey }, include: fillInclude });
    if (replay) {
      if (replay.requestHash !== hash || replay.createdByUserId !== userId) throw new OperationError(409, "La clave de operacion ya fue utilizada con otros datos");
      return replay;
    }
    const { start, end, runMinutes } = fillWindow(input.startedAt, input.endedAt);
    const comp = await compressor(tx, input.compressorId);
    if (compressorReasons(comp).length || !comp.reviewedAt || start < comp.reviewedAt || start < comp.filterInstalledAt || comp.lastRunEndedAt && start < comp.lastRunEndedAt) throw new OperationError(409, "Compresor bloqueado, intervalo anterior a la revision/recambio o carga solapada");
    if (runMinutes > filterRemaining(comp.totalRunMinutes, comp.filterBaselineMinutes, comp.filterLifeMinutes) || comp.totalRunMinutes + runMinutes > 2147483647) throw new OperationError(409, "El intervalo supera la vida restante del filtro o el contador permitido");
    const people = [input.operatorUserId, ...input.helperUserIds];
    if (await tx.user.count({ where: { id: { in: people }, isActive: true, isPendingApproval: false, deletedAt: null } }) !== people.length) throw new OperationError(400, "El encargado y los ayudantes deben estar habilitados");
    const rows = [];
    for (const item of input.items) {
      const row = await cylinder(tx, item.cylinderId);
      if (cylinderReasons(row).length || start < row.lastEventAt) throw new OperationError(409, "Cilindro bloqueado o con movimientos posteriores al inicio declarado");
      if (item.pressureBar > row.ratedPressureBar || item.pressureBar > comp.maxPressureBar || item.pressureBar < (row.pressureBar || 0)) throw new OperationError(400, "Presion incompatible con el cilindro, el compresor o la medicion anterior");
      rows.push({ row, item });
    }
    await claim(tx, "compressor", comp.id, input.revision);
    for (const { row, item } of rows) await claim(tx, "cylinder", row.id, item.revision);
    const fill = await tx.airFill.create({ data: {
      operationKey: input.operationKey, requestHash: hash, compressorId: comp.id, startedAt: start, endedAt: end, runMinutes, operatorUserId: input.operatorUserId, createdByUserId: userId, reason: input.reason, notes: input.notes,
      compressorSnapshot: { code: comp.code, name: comp.asset.name, maxPressureBar: comp.maxPressureBar, totalMinutesBefore: comp.totalRunMinutes, filterBaselineMinutes: comp.filterBaselineMinutes, filterLifeMinutes: comp.filterLifeMinutes, filterReference: comp.filterReference, airQualityReference: comp.airQualityReference, airQualityValidUntil: comp.airQualityValidUntil!.toISOString() },
      helpers: { create: input.helperUserIds.map((userId) => ({ userId })) },
      items: { create: rows.map(({ row, item }) => ({ cylinderId: row.id, pressureBar: item.pressureBar, previousPressureBar: row.pressureBar, cylinderSnapshot: { code: row.code, serialNumber: row.serialNumber, ratedPressureBar: row.ratedPressureBar, vehicleAssetId: row.vehicleAssetId, externalOwner: row.externalOwner, hydroCertificate: row.hydroTests[0]!.certificateReference, hydroValidUntil: row.hydroTests[0]!.validUntil!.toISOString() } })) },
    }, include: fillInclude });
    await tx.airCompressor.update({ where: { id: comp.id }, data: { totalRunMinutes: { increment: runMinutes }, lastRunEndedAt: end } });
    for (const { row, item } of rows) await tx.airCylinder.update({ where: { id: row.id }, data: { pressureBar: item.pressureBar, lastEventAt: end } });
    await audit(tx, userId, "AIR_FILL_RECORDED", fill.id, { compressorId: comp.id, cylinderIds: rows.map(({ row }) => row.id), runMinutes }); return fill;
  });
}
