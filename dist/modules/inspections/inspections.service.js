"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createInspection = createInspection;
exports.getAllInspections = getAllInspections;
exports.getInspectionById = getInspectionById;
exports.getVehicleInspectionHistory = getVehicleInspectionHistory;
const prisma_1 = require("../../config/prisma");
const client_1 = require("@prisma/client");
const inspections_rules_1 = require("./inspections.rules");
const control_drafts_1 = require("./control-drafts");
const inspection_presence_1 = require("./inspection-presence");
const public_user_1 = require("../../utils/public-user");
const inspection_sections_1 = require("./inspection-sections");
const notifications_service_1 = require("../members/notifications.service");
const groups_service_1 = require("../members/groups.service");
const station_time_1 = require("../../utils/station-time");
const operations_schemas_1 = require("../operations/operations.schemas");
function normalizeNullable(value) {
    if (value === undefined || value === null || value === "")
        return null;
    return value;
}
function toDateOnly(value) {
    return new Date(`${value}T00:00:00.000Z`);
}
function inventoryStateForResult(result) {
    if (result === "OK")
        return "OK";
    if (result === "MISSING")
        return "OUT";
    return "REVIEW";
}
function vehicleStatusForInspection(summary) {
    if (summary.summaryMissing > 0 ||
        summary.summaryDamaged > 0 ||
        summary.summaryUnchecked > 0) {
        return "MAINTENANCE";
    }
    return "OPERATIONAL";
}
const inspectionInclude = {
    vehicle: {
        include: {
            asset: true,
        },
    },
    responsibles: {
        include: {
            user: {
                select: public_user_1.PUBLIC_USER_SELECT,
            },
        },
    },
    leader: { select: public_user_1.PUBLIC_USER_SELECT },
    createdBy: { select: public_user_1.PUBLIC_USER_SELECT },
    items: {
        include: {
            inventoryItem: {
                include: {
                    compartment: true,
                },
            },
        },
    },
};
async function createInspection(data) {
    return prisma_1.prisma.$transaction(async (tx) => {
        await (0, require_qr_presence_1.requireQrPresence)(tx, data.createdByUserId);
        const member = await tx.controlGroupMember.findUnique({ where: { userId: data.createdByUserId }, include: { group: { include: { members: true } } } });
        if (!member)
            throw new operations_schemas_1.OperationError(403, "Debe integrar un grupo de control asignado");
        const week = (0, groups_service_1.nextControlWeek)(member.group.startsOn, member.group.repeatWeeks, new Date((0, station_time_1.stationDate)(new Date(Date.now())) + "T00:00:00Z"));
        if (!week.current || data.inspectionDate < week.start.toISOString().slice(0, 10) || data.inspectionDate >= week.end.toISOString().slice(0, 10))
            throw new operations_schemas_1.OperationError(403, "Solo puede registrar controles durante la semana vigente de su grupo");
        // H04: el autor integra el grupo de la semana; los ayudantes de otros grupos se validan por su presencia QR en el borrador.
        if (!data.responsibleUserIds.includes(data.createdByUserId))
            throw new operations_schemas_1.OperationError(403, "El autor debe integrar el grupo habilitado esta semana y participar del control");
        const vehicle = await tx.vehicle.findUnique({
            where: { id: data.vehicleId },
            include: {
                asset: true,
                compartments: {
                    include: {
                        items: true,
                    },
                },
            },
        });
        if (!vehicle || vehicle.asset.deletedAt) {
            throw new Error("Vehicle not found");
        }
        const allVehicleItems = vehicle.compartments.flatMap((compartment) => compartment.items);
        const observations = (0, inspection_sections_1.inspectionNotes)(data.observations, data.sectionComments || [], vehicle.compartments);
        if (!allVehicleItems.length) {
            throw new Error("El vehiculo no tiene materiales configurados para controlar");
        }
        const inventoryIds = new Set(allVehicleItems.map((item) => item.id));
        const submittedIds = new Set(data.items.map((item) => item.inventoryItemId));
        if (submittedIds.size !== data.items.length) {
            throw new Error("El control contiene materiales repetidos");
        }
        if (submittedIds.size !== inventoryIds.size || [...inventoryIds].some((id) => !submittedIds.has(id))) {
            throw new Error("El control debe incluir todos los materiales del vehiculo");
        }
        for (const item of data.items) {
            if (!inventoryIds.has(item.inventoryItemId)) {
                throw new Error(`Inventory item ${item.inventoryItemId} does not belong to this vehicle`);
            }
            const baseItem = allVehicleItems.find((candidate) => candidate.id === item.inventoryItemId);
            (0, inspections_rules_1.validateMaterial)(item, baseItem.expectedQuantity);
        }
        const responsibleUserIds = Array.from(new Set(data.responsibleUserIds));
        if (!responsibleUserIds.includes(data.leaderUserId)) {
            throw new Error("El encargado debe integrar el equipo que realizo el control");
        }
        const responsibleUsers = await tx.user.findMany({
            where: {
                id: { in: responsibleUserIds },
                isActive: true,
                isPendingApproval: false,
                deletedAt: null,
            },
            select: { id: true },
        });
        if (responsibleUsers.length !== responsibleUserIds.length) {
            throw new Error("Una o mas personas responsables no existen o estan inactivas");
        }
        const misplaced = data.items.filter((i) => i.foundElsewhere).length;
        const expired = allVehicleItems.filter((i) => i.expiresOn && i.expiresOn.toISOString().slice(0, 10) < data.inspectionDate).length;
        const summaryOk = data.items.filter((i) => i.result === "OK").length;
        const summaryMissing = data.items.filter((i) => i.result === "MISSING").length;
        const summaryDamaged = data.items.filter((i) => i.result === "DAMAGED").length;
        const summaryUnchecked = 0;
        const inspectionDate = toDateOnly(data.inspectionDate);
        const timestamp = (0, inspections_rules_1.inspectionTimestamp)(data.inspectionDate, data.inspectionTime);
        if (!Number.isFinite(timestamp) || timestamp > Date.now()) {
            throw new operations_schemas_1.OperationError(400, "El control no puede tener fecha u hora futura");
        }
        await (0, inspection_presence_1.requireInspectionPresence)(tx, data.createdByUserId, timestamp);
        const latest = await tx.inspection.findFirst({
            where: { vehicleId: data.vehicleId, voidedAt: null },
            orderBy: [{ inspectionDate: "desc" }, { inspectionTime: "desc" }, { createdAt: "desc" }],
            select: { inspectionDate: true, inspectionTime: true },
        });
        const appliesToCurrentState = !latest || timestamp >= (0, inspections_rules_1.inspectionTimestamp)(latest.inspectionDate.toISOString().slice(0, 10), latest.inspectionTime || "00:00");
        const blockingJob = await tx.maintenanceJob.findFirst({
            where: { assetId: vehicle.assetId, blocksOperation: true, status: { in: ["OPEN", "IN_PROGRESS"] } },
            select: { id: true },
        });
        const lastClosedJob = await tx.maintenanceJob.findFirst({
            where: { assetId: vehicle.assetId, blocksOperation: true, status: { in: ["RESOLVED", "CANCELLED"] }, resolvedAt: { not: null } },
            orderBy: { resolvedAt: "desc" },
            select: { resolvedAt: true },
        });
        const needsRecheck = lastClosedJob?.resolvedAt
            ? Math.floor(timestamp / 60000) < Math.floor(lastClosedJob.resolvedAt.getTime() / 60000)
            : false;
        const vehicleStatus = (appliesToCurrentState && (blockingJob || needsRecheck)) || misplaced || expired ? "MAINTENANCE" : vehicleStatusForInspection({
            summaryMissing,
            summaryDamaged,
            summaryUnchecked,
        });
        if (!data.draftId)
            throw new operations_schemas_1.OperationError(400, "Inicie el borrador del control antes de finalizarlo");
        await tx.$queryRaw `SELECT "id" FROM "ControlDraft" WHERE "id" = ${data.draftId} FOR UPDATE`;
        const draft = await tx.controlDraft.findUnique({ where: { id: data.draftId } });
        if (!draft || draft.ownerId !== data.createdByUserId || draft.vehicleId !== data.vehicleId || draft.closedAt)
            throw new operations_schemas_1.OperationError(409, "El borrador no corresponde o ya fue finalizado");
        const participants = (0, control_drafts_1.draftParticipants)(draft.participants);
        if (responsibleUserIds.length !== participants.length || responsibleUserIds.some(id => !participants.some(p => p.userId === id)))
            throw new operations_schemas_1.OperationError(409, "El equipo no coincide con el borrador. Actualice la selección");
        if (timestamp < Math.floor(+draft.startedAt / 60000) * 60000)
            throw new operations_schemas_1.OperationError(400, "El control no puede ser anterior al inicio registrado");
        await tx.controlDraft.update({ where: { id: draft.id }, data: { closedAt: new Date(), revision: { increment: 1 } } });
        const createdInspection = await tx.inspection.create({
            data: {
                confirmationsComplete: responsibleUserIds.length === 1,
                draftId: draft.id,
                vehicleId: data.vehicleId,
                incidentType: data.incidentType,
                inspectionDate,
                inspectionTime: normalizeNullable(data.inspectionTime),
                observations,
                leaderUserId: data.leaderUserId,
                createdByUserId: data.createdByUserId,
                resultingAssetStatus: vehicleStatus,
                summaryOk,
                summaryMissing,
                summaryDamaged,
                summaryUnchecked,
            },
        });
        await tx.inspectionResponsible.createMany({
            data: responsibleUserIds.map((userId) => ({
                inspectionId: createdInspection.id,
                participatedAt: new Date(participants.find(p => p.userId === userId).joinedAt),
                userId,
                confirmedAt: userId === data.createdByUserId ? new Date() : null,
            })),
        });
        for (const item of data.items) {
            const baseItem = allVehicleItems.find((candidate) => candidate.id === item.inventoryItemId);
            await tx.inspectionItem.create({
                data: {
                    inspectionId: createdInspection.id,
                    inventoryItemId: item.inventoryItemId,
                    expectedQuantity: baseItem.expectedQuantity,
                    observedQuantity: item.observedQuantity,
                    result: item.result,
                    observations: normalizeNullable(item.observations),
                    foundElsewhere: item.foundElsewhere ?? false,
                    foundLocation: item.foundElsewhere ? item.foundLocation : null,
                },
            });
        }
        if (appliesToCurrentState) {
            for (const item of data.items) {
                await tx.vehicleInventoryItem.update({
                    where: { id: item.inventoryItemId },
                    data: {
                        state: item.foundElsewhere || (allVehicleItems.find((i) => i.id === item.inventoryItemId)?.expiresOn?.toISOString().slice(0, 10) || "9999") < data.inspectionDate ? "REVIEW" : inventoryStateForResult(item.result),
                        revision: { increment: 1 },
                    },
                });
            }
            await tx.asset.update({
                where: { id: vehicle.assetId },
                data: {
                    status: vehicle.asset.status === "OUT_OF_SERVICE" ? "OUT_OF_SERVICE" : responsibleUserIds.length > 1 ? "MAINTENANCE" : vehicleStatus,
                    lastCheckDate: inspectionDate,
                },
            });
        }
        await tx.auditLog.create({
            data: {
                actorUserId: data.createdByUserId,
                action: "INSPECTION_CREATED",
                entityType: "Inspection",
                entityId: createdInspection.id,
                metadata: {
                    vehicleId: data.vehicleId,
                    summaryOk,
                    summaryMissing,
                    summaryDamaged,
                    summaryUnchecked,
                    leaderUserId: data.leaderUserId,
                    responsibleUserIds,
                    resultingAssetStatus: vehicleStatus,
                    appliesToCurrentState,
                    blockingMaintenanceId: blockingJob?.id || null,
                    needsRecheck,
                    misplaced,
                    expired,
                },
            },
        });
        if (appliesToCurrentState && (summaryMissing || summaryDamaged || misplaced || expired)) {
            const dueAt = new Date(Date.now() + 86400000);
            const description = `Control ${createdInspection.id}: ${summaryMissing} faltantes, ${summaryDamaged} dañados, ${misplaced} fuera de lugar, ${expired} vencidos. Revisar inventario y adjuntar evidencia de la correccion; requiere nuevo control fisico.`;
            const job = await tx.maintenanceJob.create({ data: { assetId: vehicle.assetId, title: "Corregir novedades de control vehicular", description, blocksOperation: true, dueAt, responsibleUserId: data.leaderUserId, createdByUserId: data.createdByUserId } });
            const task = await tx.workTask.create({ data: { title: "Corregir novedades de control vehicular", description, priority: "HIGH", dueOn: new Date(dueAt.toISOString().slice(0, 10)), maintenanceJobId: job.id, createdByUserId: data.createdByUserId, members: { create: { userId: data.leaderUserId } } } });
            await tx.inspection.update({ where: { id: createdInspection.id }, data: { repairTaskId: task.id } });
            await tx.auditLog.create({ data: { actorUserId: data.createdByUserId, action: "INSPECTION_REPAIR_ASSIGNED", entityType: "Inspection", entityId: createdInspection.id, metadata: { taskId: task.id, maintenanceJobId: job.id, responsibleUserId: data.leaderUserId, dueAt } } });
            await (0, notifications_service_1.notify)(tx, [data.leaderUserId], "Reparacion prioritaria asignada por control vehicular", "/tasks", description);
        }
        await (0, notifications_service_1.notify)(tx, responsibleUserIds.filter(id => id !== data.createdByUserId), "Confirme su participacion en el control vehicular", `/equipment/${vehicle.assetId}/history`, "Revise la planilla y confirme solo si participo. El control no se completa hasta recibir todas las confirmaciones.");
        if (summaryMissing || summaryDamaged || misplaced || expired || data.sectionComments?.some((section) => section.observations.trim())) {
            const staff = await tx.user.findMany({ where: { isActive: true, deletedAt: null, isPendingApproval: false }, select: { id: true } });
            await (0, notifications_service_1.notify)(tx, staff.map((person) => person.id).filter((id) => id !== data.createdByUserId), "Control vehicular registrado con novedades", `/equipment/${vehicle.assetId}/history`);
        }
        return tx.inspection.findUnique({
            where: { id: createdInspection.id },
            include: inspectionInclude,
        });
    }, { isolationLevel: client_1.Prisma.TransactionIsolationLevel.Serializable });
}
async function getAllInspections(vehicleId) {
    return prisma_1.prisma.inspection.findMany({
        where: vehicleId ? { vehicleId } : undefined,
        include: inspectionInclude,
        orderBy: [{ inspectionDate: "desc" }, { inspectionTime: "desc" }, { createdAt: "desc" }],
    });
}
async function getInspectionById(inspectionId) {
    const inspection = await prisma_1.prisma.inspection.findUnique({
        where: { id: inspectionId },
        include: inspectionInclude,
    });
    if (!inspection) {
        throw new Error("Inspection not found");
    }
    return inspection;
}
async function getVehicleInspectionHistory(vehicleId) {
    const vehicle = await prisma_1.prisma.vehicle.findUnique({
        where: { id: vehicleId },
    });
    if (!vehicle) {
        throw new Error("Vehicle not found");
    }
    return prisma_1.prisma.inspection.findMany({
        where: { vehicleId },
        include: inspectionInclude,
        orderBy: [{ inspectionDate: "desc" }, { inspectionTime: "desc" }, { createdAt: "desc" }],
    });
}
const require_qr_presence_1 = require("../../utils/require-qr-presence");
