"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listAir = listAir;
exports.listAirHistory = listAirHistory;
exports.createAirCylinder = createAirCylinder;
exports.createAirCompressor = createAirCompressor;
exports.recordHydro = recordHydro;
exports.updateAirStatus = updateAirStatus;
exports.moveAirCylinder = moveAirCylinder;
exports.recordPressure = recordPressure;
exports.changeAirFilter = changeAirFilter;
exports.retireAir = retireAir;
exports.recordAirFill = recordAirFill;
const node_crypto_1 = require("node:crypto");
const prisma_1 = require("../../config/prisma");
const transaction_1 = require("../../utils/transaction");
const station_time_1 = require("../../utils/station-time");
const public_user_1 = require("../../utils/public-user");
const operations_schemas_1 = require("../operations/operations.schemas");
const air_rules_1 = require("./air.rules");
const blocked = { blocksOperation: true, status: { in: ["OPEN", "IN_PROGRESS"] } };
const asset = { select: { id: true, name: true, status: true, deletedAt: true, maintenanceJobs: { where: blocked, select: { id: true } } } };
const cylinderInclude = { asset, vehicle: { select: { id: true, name: true } }, hydroTests: { take: 1, orderBy: [{ testedOn: "desc" }, { createdAt: "desc" }, { id: "desc" }], include: { registeredBy: { select: public_user_1.PUBLIC_USER_SELECT } } } };
const compressorInclude = { asset, filterChanges: { take: 3, orderBy: [{ changedAt: "desc" }, { id: "desc" }], include: { changedBy: { select: public_user_1.PUBLIC_USER_SELECT } } } };
const fillInclude = { compressor: { select: { code: true } }, operator: { select: public_user_1.PUBLIC_USER_SELECT }, createdBy: { select: public_user_1.PUBLIC_USER_SELECT }, helpers: { include: { user: { select: public_user_1.PUBLIC_USER_SELECT } } }, items: true };
async function audit(tx, userId, action, entityId, metadata = {}) {
    await tx.auditLog.create({ data: { actorUserId: userId, action, entityType: "AirEquipment", entityId, metadata } });
}
async function cylinder(tx, id) {
    const row = await tx.airCylinder.findUnique({ where: { id }, include: cylinderInclude });
    if (!row || row.asset.deletedAt)
        throw new operations_schemas_1.OperationError(404, "Cilindro no encontrado");
    return row;
}
async function compressor(tx, id) {
    const row = await tx.airCompressor.findUnique({ where: { id }, include: compressorInclude });
    if (!row || row.asset.deletedAt)
        throw new operations_schemas_1.OperationError(404, "Compresor no encontrado");
    return row;
}
async function claim(tx, kind, id, revision) {
    const where = { id, revision, retiredAt: null };
    const row = kind === "cylinder" ? await tx.airCylinder.updateMany({ where, data: { revision: { increment: 1 }, lastEventAt: new Date() } }) : await tx.airCompressor.updateMany({ where, data: { revision: { increment: 1 } } });
    if (!row.count)
        throw new operations_schemas_1.OperationError(409, "El equipo cambio o fue dado de baja. Recargue antes de continuar.");
}
async function vehicleExists(tx, id) {
    if (id && !await tx.asset.findFirst({ where: { id, assetType: "VEHICLE", deletedAt: null }, select: { id: true } }))
        throw new operations_schemas_1.OperationError(400, "El movil seleccionado no existe");
}
function cylinderReasons(row) {
    return [row.retiredAt && "Dado de baja", row.asset.status !== "OPERATIONAL" && "Requiere revision de estado", row.asset.maintenanceJobs.length > 0 && "Mantenimiento bloqueante", !(0, air_rules_1.hydroCurrent)(row.hydroTests[0], (0, station_time_1.stationDate)()) && "Prueba hidraulica ausente, rechazada o vencida", !row.reviewedAt && "Sin revision registrada"].filter(Boolean);
}
function compressorReasons(row) {
    return [row.retiredAt && "Dado de baja", row.asset.status !== "OPERATIONAL" && "Requiere revision de estado", row.asset.maintenanceJobs.length > 0 && "Mantenimiento bloqueante", !row.reviewedAt && "Sin revision registrada", (!row.airQualityReference || !row.airQualityValidUntil || row.airQualityValidUntil.toISOString().slice(0, 10) < (0, station_time_1.stationDate)()) && "Registro de calidad de aire ausente o vencido", (0, air_rules_1.filterRemaining)(row.totalRunMinutes, row.filterBaselineMinutes, row.filterLifeMinutes) === 0 && "Filtro agotado"].filter(Boolean);
}
async function listAir(kind, filters) {
    const where = { retiredAt: filters.retired === "true" ? { not: null } : null, asset: { deletedAt: null }, ...(filters.q ? { OR: [{ code: { contains: filters.q, mode: "insensitive" } }, { asset: { name: { contains: filters.q, mode: "insensitive" } } }] } : {}) };
    if (kind === "cylinders") {
        const [rows, total] = await prisma_1.prisma.$transaction([prisma_1.prisma.airCylinder.findMany({ where, include: cylinderInclude, orderBy: { code: "asc" }, skip: (filters.page - 1) * 30, take: 30 }), prisma_1.prisma.airCylinder.count({ where })], { isolationLevel: "RepeatableRead" });
        return { items: rows.map((row) => ({ ...row, blockingReasons: cylinderReasons(row) })), total, page: filters.page, pageSize: 30 };
    }
    const [rows, total] = await prisma_1.prisma.$transaction([prisma_1.prisma.airCompressor.findMany({ where, include: compressorInclude, orderBy: { code: "asc" }, skip: (filters.page - 1) * 30, take: 30 }), prisma_1.prisma.airCompressor.count({ where })], { isolationLevel: "RepeatableRead" });
    return { items: rows.map((row) => ({ ...row, remainingFilterMinutes: (0, air_rules_1.filterRemaining)(row.totalRunMinutes, row.filterBaselineMinutes, row.filterLifeMinutes), blockingReasons: compressorReasons(row) })), total, page: filters.page, pageSize: 30 };
}
async function listAirHistory(kind, filters) {
    const paging = { skip: (filters.page - 1) * 30, take: 30 };
    if (kind === "fills") {
        const where = { ...(filters.compressorId ? { compressorId: filters.compressorId } : {}), ...(filters.cylinderId ? { items: { some: { cylinderId: filters.cylinderId } } } : {}) };
        const [items, total] = await prisma_1.prisma.$transaction([prisma_1.prisma.airFill.findMany({ where, include: fillInclude, orderBy: [{ startedAt: "desc" }, { id: "desc" }], ...paging }), prisma_1.prisma.airFill.count({ where })]);
        return { items, total, page: filters.page, pageSize: 30 };
    }
    if (kind === "tests") {
        const where = { cylinderId: filters.cylinderId };
        const [items, total] = await prisma_1.prisma.$transaction([prisma_1.prisma.airHydroTest.findMany({ where, include: { registeredBy: { select: public_user_1.PUBLIC_USER_SELECT } }, orderBy: [{ testedOn: "desc" }, { createdAt: "desc" }, { id: "desc" }], ...paging }), prisma_1.prisma.airHydroTest.count({ where })]);
        return { items, total, page: filters.page, pageSize: 30 };
    }
    const where = { compressorId: filters.compressorId };
    const [items, total] = await prisma_1.prisma.$transaction([prisma_1.prisma.airFilterChange.findMany({ where, include: { changedBy: { select: public_user_1.PUBLIC_USER_SELECT } }, orderBy: [{ changedAt: "desc" }, { id: "desc" }], ...paging }), prisma_1.prisma.airFilterChange.count({ where })]);
    return { items, total, page: filters.page, pageSize: 30 };
}
async function createAirCylinder(input, userId) {
    return (0, transaction_1.serializable)(async (tx) => {
        await vehicleExists(tx, input.vehicleAssetId);
        const { name, vehicleAssetId, ...data } = input;
        const row = await tx.airCylinder.create({ data: { ...data, ...(vehicleAssetId ? { vehicle: { connect: { id: vehicleAssetId } } } : {}), externalOwner: data.externalOwner || null, asset: { create: { name, assetType: "PPE", status: "MAINTENANCE" } } } });
        await audit(tx, userId, "AIR_CYLINDER_CREATED", row.id, { code: row.code });
        return row;
    });
}
async function createAirCompressor(input, userId) {
    if (new Date(input.filterInstalledAt) > new Date())
        throw new operations_schemas_1.OperationError(400, "La instalacion del filtro no puede ser futura");
    return (0, transaction_1.serializable)(async (tx) => {
        const row = await tx.airCompressor.create({ data: {
                code: input.code, maxPressureBar: input.maxPressureBar, filterLifeMinutes: input.filterLifeMinutes, filterReference: input.filterReference, filterInstalledAt: new Date(input.filterInstalledAt),
                totalRunMinutes: input.initialTotalMinutes, filterBaselineMinutes: input.initialTotalMinutes - input.initialFilterUsedMinutes,
                asset: { create: { name: input.name, assetType: "OTHER", status: "MAINTENANCE" } },
            } });
        await audit(tx, userId, "AIR_COMPRESSOR_CREATED", row.id, { initialTotalMinutes: row.totalRunMinutes, initialFilterUsedMinutes: input.initialFilterUsedMinutes });
        return row;
    });
}
async function recordHydro(id, input, userId) {
    return (0, transaction_1.serializable)(async (tx) => {
        const row = await cylinder(tx, id);
        if (input.testedOn > (0, station_time_1.stationDate)() || row.hydroTests[0] && input.testedOn < row.hydroTests[0].testedOn.toISOString().slice(0, 10))
            throw new operations_schemas_1.OperationError(400, "La fecha no puede ser futura ni anterior a la ultima prueba registrada");
        await claim(tx, "cylinder", id, input.revision);
        const test = await tx.airHydroTest.create({ data: { cylinderId: id, result: input.result, testedOn: new Date(input.testedOn + "T00:00:00Z"), validUntil: input.validUntil ? new Date(input.validUntil + "T00:00:00Z") : null, certificateReference: input.certificateReference, notes: input.notes, registeredByUserId: userId } });
        await tx.airCylinder.update({ where: { id }, data: { reviewedAt: null } });
        await tx.asset.update({ where: { id: row.assetId }, data: { status: input.result === "FAIL" || row.asset.status === "OUT_OF_SERVICE" ? "OUT_OF_SERVICE" : "MAINTENANCE" } });
        await audit(tx, userId, "AIR_HYDRO_REGISTERED", id, { testId: test.id, result: input.result });
        return test;
    });
}
async function updateAirStatus(kind, id, input, userId) {
    return (0, transaction_1.serializable)(async (tx) => {
        const row = kind === "cylinder" ? await cylinder(tx, id) : await compressor(tx, id);
        if (input.status === "OPERATIONAL") {
            if (row.asset.maintenanceJobs.length)
                throw new operations_schemas_1.OperationError(409, "Cierre el mantenimiento bloqueante antes de registrar la revision");
            if (kind === "cylinder") {
                if (!(0, air_rules_1.hydroCurrent)(row.hydroTests[0], (0, station_time_1.stationDate)()))
                    throw new operations_schemas_1.OperationError(409, "Se requiere una prueba hidraulica aprobada y vigente");
            }
            else {
                const comp = row;
                if (!input.airQualityReference || !input.airQualityValidUntil || input.airQualityValidUntil < (0, station_time_1.stationDate)())
                    throw new operations_schemas_1.OperationError(400, "Ingrese referencia y vigencia del control de calidad de aire");
                if (!(0, air_rules_1.filterRemaining)(comp.totalRunMinutes, comp.filterBaselineMinutes, comp.filterLifeMinutes))
                    throw new operations_schemas_1.OperationError(409, "El filtro esta agotado");
            }
        }
        await claim(tx, kind, id, input.revision);
        const reviewedAt = input.status === "OPERATIONAL" ? new Date() : null;
        if (kind === "cylinder")
            await tx.airCylinder.update({ where: { id }, data: { reviewedAt } });
        else
            await tx.airCompressor.update({ where: { id }, data: { reviewedAt, ...(input.status === "OPERATIONAL" ? { airQualityReference: input.airQualityReference, airQualityValidUntil: new Date(input.airQualityValidUntil + "T00:00:00Z") } : {}) } });
        await tx.asset.update({ where: { id: row.assetId }, data: { status: input.status, lastCheckDate: reviewedAt || undefined } });
        await audit(tx, userId, "AIR_STATE_REVIEWED", id, { kind, status: input.status, notes: input.notes, airQualityReference: input.airQualityReference || null, airQualityValidUntil: input.airQualityValidUntil || null });
        return { message: "Revision de estado registrada" };
    });
}
async function moveAirCylinder(id, input, userId) {
    return (0, transaction_1.serializable)(async (tx) => {
        const row = await cylinder(tx, id);
        await vehicleExists(tx, input.vehicleAssetId);
        await claim(tx, "cylinder", id, input.revision);
        await tx.airCylinder.update({ where: { id }, data: { vehicleAssetId: input.vehicleAssetId } });
        await audit(tx, userId, "AIR_CYLINDER_MOVED", id, { from: row.vehicleAssetId, to: input.vehicleAssetId, notes: input.notes });
        return { message: "Ubicacion actualizada" };
    });
}
async function recordPressure(id, input, userId) {
    return (0, transaction_1.serializable)(async (tx) => {
        const row = await cylinder(tx, id);
        if (input.pressureBar > row.ratedPressureBar)
            throw new operations_schemas_1.OperationError(400, "La presion supera el limite nominal registrado");
        await claim(tx, "cylinder", id, input.revision);
        await tx.airCylinder.update({ where: { id }, data: { pressureBar: input.pressureBar } });
        await audit(tx, userId, "AIR_PRESSURE_MEASURED", id, { previousPressureBar: row.pressureBar, pressureBar: input.pressureBar, notes: input.notes });
        return { message: "Medicion registrada; no modifica la habilitacion" };
    });
}
async function changeAirFilter(id, input, userId) {
    return (0, transaction_1.serializable)(async (tx) => {
        const row = await compressor(tx, id);
        await claim(tx, "compressor", id, input.revision);
        const change = await tx.airFilterChange.create({ data: { compressorId: id, totalMinutesSnapshot: row.totalRunMinutes, previousBaselineMinutes: row.filterBaselineMinutes, previousLifeMinutes: row.filterLifeMinutes, previousReference: row.filterReference, newLifeMinutes: input.filterLifeMinutes, newReference: input.filterReference, notes: input.notes, changedByUserId: userId } });
        await tx.airCompressor.update({ where: { id }, data: { filterBaselineMinutes: row.totalRunMinutes, filterLifeMinutes: input.filterLifeMinutes, filterReference: input.filterReference, filterInstalledAt: change.changedAt, reviewedAt: null, airQualityReference: null, airQualityValidUntil: null } });
        await tx.asset.update({ where: { id: row.assetId }, data: { status: row.asset.status === "OUT_OF_SERVICE" ? "OUT_OF_SERVICE" : "MAINTENANCE" } });
        await audit(tx, userId, "AIR_FILTER_CHANGED", id, { changeId: change.id, totalRunMinutes: row.totalRunMinutes });
        return change;
    });
}
async function retireAir(kind, id, revision, notes, userId) {
    return (0, transaction_1.serializable)(async (tx) => {
        const row = kind === "cylinder" ? await cylinder(tx, id) : await compressor(tx, id);
        await claim(tx, kind, id, revision);
        if (kind === "cylinder")
            await tx.airCylinder.update({ where: { id }, data: { retiredAt: new Date() } });
        else
            await tx.airCompressor.update({ where: { id }, data: { retiredAt: new Date() } });
        await tx.asset.update({ where: { id: row.assetId }, data: { status: "OUT_OF_SERVICE" } });
        await audit(tx, userId, "AIR_EQUIPMENT_RETIRED", id, { kind, notes });
        return { message: "Baja registrada; historial conservado" };
    });
}
async function recordAirFill(input, userId) {
    const hash = (0, node_crypto_1.createHash)("sha256").update(JSON.stringify({ ...input, helperUserIds: [...input.helperUserIds].sort(), items: [...input.items].sort((a, b) => a.cylinderId.localeCompare(b.cylinderId)) })).digest("hex");
    return (0, transaction_1.serializable)(async (tx) => {
        const replay = await tx.airFill.findUnique({ where: { operationKey: input.operationKey }, include: fillInclude });
        if (replay) {
            if (replay.requestHash !== hash || replay.createdByUserId !== userId)
                throw new operations_schemas_1.OperationError(409, "La clave de operacion ya fue utilizada con otros datos");
            return replay;
        }
        const { start, end, runMinutes } = (0, air_rules_1.fillWindow)(input.startedAt, input.endedAt);
        const comp = await compressor(tx, input.compressorId);
        if (compressorReasons(comp).length || !comp.reviewedAt || start < comp.reviewedAt || start < comp.filterInstalledAt || comp.lastRunEndedAt && start < comp.lastRunEndedAt)
            throw new operations_schemas_1.OperationError(409, "Compresor bloqueado, intervalo anterior a la revision/recambio o carga solapada");
        if (runMinutes > (0, air_rules_1.filterRemaining)(comp.totalRunMinutes, comp.filterBaselineMinutes, comp.filterLifeMinutes) || comp.totalRunMinutes + runMinutes > 2147483647)
            throw new operations_schemas_1.OperationError(409, "El intervalo supera la vida restante del filtro o el contador permitido");
        const people = [input.operatorUserId, ...input.helperUserIds];
        if (await tx.user.count({ where: { id: { in: people }, isActive: true, isPendingApproval: false, deletedAt: null } }) !== people.length)
            throw new operations_schemas_1.OperationError(400, "El encargado y los ayudantes deben estar habilitados");
        const rows = [];
        for (const item of input.items) {
            const row = await cylinder(tx, item.cylinderId);
            if (cylinderReasons(row).length || start < row.lastEventAt)
                throw new operations_schemas_1.OperationError(409, "Cilindro bloqueado o con movimientos posteriores al inicio declarado");
            if (item.pressureBar > row.ratedPressureBar || item.pressureBar > comp.maxPressureBar || item.pressureBar < (row.pressureBar || 0))
                throw new operations_schemas_1.OperationError(400, "Presion incompatible con el cilindro, el compresor o la medicion anterior");
            rows.push({ row, item });
        }
        await claim(tx, "compressor", comp.id, input.revision);
        for (const { row, item } of rows)
            await claim(tx, "cylinder", row.id, item.revision);
        const fill = await tx.airFill.create({ data: {
                operationKey: input.operationKey, requestHash: hash, compressorId: comp.id, startedAt: start, endedAt: end, runMinutes, operatorUserId: input.operatorUserId, createdByUserId: userId, reason: input.reason, notes: input.notes,
                compressorSnapshot: { code: comp.code, name: comp.asset.name, maxPressureBar: comp.maxPressureBar, totalMinutesBefore: comp.totalRunMinutes, filterBaselineMinutes: comp.filterBaselineMinutes, filterLifeMinutes: comp.filterLifeMinutes, filterReference: comp.filterReference, airQualityReference: comp.airQualityReference, airQualityValidUntil: comp.airQualityValidUntil.toISOString() },
                helpers: { create: input.helperUserIds.map((userId) => ({ userId })) },
                items: { create: rows.map(({ row, item }) => ({ cylinderId: row.id, pressureBar: item.pressureBar, previousPressureBar: row.pressureBar, cylinderSnapshot: { code: row.code, serialNumber: row.serialNumber, ratedPressureBar: row.ratedPressureBar, vehicleAssetId: row.vehicleAssetId, externalOwner: row.externalOwner, hydroCertificate: row.hydroTests[0].certificateReference, hydroValidUntil: row.hydroTests[0].validUntil.toISOString() } })) },
            }, include: fillInclude });
        await tx.airCompressor.update({ where: { id: comp.id }, data: { totalRunMinutes: { increment: runMinutes }, lastRunEndedAt: end } });
        for (const { row, item } of rows)
            await tx.airCylinder.update({ where: { id: row.id }, data: { pressureBar: item.pressureBar, lastEventAt: end } });
        await audit(tx, userId, "AIR_FILL_RECORDED", fill.id, { compressorId: comp.id, cylinderIds: rows.map(({ row }) => row.id), runMinutes });
        return fill;
    });
}
