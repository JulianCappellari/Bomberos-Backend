"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.publishMaintenanceTask = publishMaintenanceTask;
exports.listMaintenance = listMaintenance;
exports.createMaintenance = createMaintenance;
exports.transitionMaintenance = transitionMaintenance;
const prisma_1 = require("../../config/prisma");
const transaction_1 = require("../../utils/transaction");
const public_user_1 = require("../../utils/public-user");
const notifications_service_1 = require("../members/notifications.service");
const operations_schemas_1 = require("./operations.schemas");
const include = {
    publicTask: { select: { id: true, status: true } },
    asset: { select: { id: true, name: true, status: true, assetType: true } },
    responsible: { select: public_user_1.PUBLIC_USER_SELECT },
    createdBy: { select: public_user_1.PUBLIC_USER_SELECT },
};
async function publishMaintenanceTask(id, actorUserId) {
    return (0, transaction_1.serializable)(async (tx) => {
        const job = await tx.maintenanceJob.findUnique({ where: { id }, include });
        if (!job || !["OPEN", "IN_PROGRESS"].includes(job.status))
            throw new operations_schemas_1.OperationError(409, "Solo se publican trabajos de mantenimiento abiertos");
        if (job.publicTask)
            return { id: job.publicTask.id, existing: true };
        const task = await tx.workTask.create({ data: { title: `Mantenimiento: ${job.title}`.slice(0, 160), description: `${job.asset.name}: ${job.description}`.slice(0, 4000), dueOn: job.dueAt, maintenanceJobId: id, createdByUserId: actorUserId } });
        await tx.auditLog.create({ data: { actorUserId, action: "MAINTENANCE_TASK_CREATED", entityType: "WorkTask", entityId: task.id, metadata: { maintenanceJobId: id } } });
        return { id: task.id, existing: false };
    });
}
async function listMaintenance(filters, role) {
    if (!(0, operations_schemas_1.isDutyManager)(role))
        throw new operations_schemas_1.OperationError(403, "Modulo reservado a mando o guardia");
    const rows = await prisma_1.prisma.maintenanceJob.findMany({
        where: { ...filters }, include,
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    });
    return rows.map((row) => ({ ...row, costCents: (0, operations_schemas_1.isDutyManager)(role) ? row.costCents : null }));
}
async function createMaintenance(input, actorUserId) {
    return (0, transaction_1.serializable)(async (tx) => {
        const asset = await tx.asset.findFirst({ where: { id: input.assetId, deletedAt: null } });
        if (!asset)
            throw new operations_schemas_1.OperationError(404, "Vehiculo o equipo no encontrado");
        if (input.responsibleUserId) {
            const responsible = await tx.user.findFirst({
                where: { id: input.responsibleUserId, isActive: true, isPendingApproval: false, deletedAt: null }, select: { id: true },
            });
            if (!responsible)
                throw new operations_schemas_1.OperationError(400, "El responsable no esta habilitado");
        }
        const job = await tx.maintenanceJob.create({
            data: {
                assetId: input.assetId, title: input.title, description: input.description, blocksOperation: input.blocksOperation,
                dueAt: input.dueAt ? new Date(input.dueAt + "T00:00:00Z") : null,
                responsibleUserId: input.responsibleUserId || null,
                createdByUserId: actorUserId,
            }, include,
        });
        if (input.publishTask) {
            const task = await tx.workTask.create({ data: { title: `Mantenimiento: ${input.title}`.slice(0, 160), description: `${asset.name}: ${input.description}`.slice(0, 4000), dueOn: job.dueAt, maintenanceJobId: job.id, createdByUserId: actorUserId, ...(input.responsibleUserId ? { members: { create: { userId: input.responsibleUserId } } } : {}) } });
            await tx.auditLog.create({ data: { actorUserId, action: "MAINTENANCE_TASK_CREATED", entityType: "WorkTask", entityId: task.id, metadata: { maintenanceJobId: job.id } } });
            if (input.responsibleUserId)
                await (0, notifications_service_1.notify)(tx, [input.responsibleUserId], `Tarea de mantenimiento: ${input.title}`, "/tasks");
        }
        if (input.blocksOperation && asset.status !== "OUT_OF_SERVICE") {
            await tx.asset.update({ where: { id: asset.id }, data: { status: "MAINTENANCE" } });
        }
        await tx.auditLog.create({
            data: {
                actorUserId, action: "MAINTENANCE_CREATED", entityType: "MaintenanceJob", entityId: job.id,
                metadata: { assetId: asset.id, blocksOperation: input.blocksOperation },
            },
        });
        return tx.maintenanceJob.findUniqueOrThrow({ where: { id: job.id }, include });
    });
}
async function transitionMaintenance(id, input, actorUserId) {
    return (0, transaction_1.serializable)(async (tx) => {
        const existing = await tx.maintenanceJob.findUnique({ where: { id } });
        if (!existing)
            throw new operations_schemas_1.OperationError(404, "Trabajo no encontrado");
        (0, operations_schemas_1.assertMaintenanceTransition)(existing.status, input.status);
        const changed = await tx.maintenanceJob.updateMany({
            where: { id, revision: input.revision, status: existing.status },
            data: {
                status: input.status, resolution: input.resolution || null, costCents: input.costCents ?? null,
                resolvedAt: ["RESOLVED", "CANCELLED"].includes(input.status) ? new Date() : null,
                revision: { increment: 1 },
            },
        });
        if (!changed.count)
            throw new operations_schemas_1.OperationError(409, "El trabajo cambio. Recargue antes de continuar.");
        if (["RESOLVED", "CANCELLED"].includes(input.status)) {
            const task = await tx.workTask.findUnique({ where: { maintenanceJobId: id } });
            if (task && !["VERIFIED", "CANCELLED"].includes(task.status)) {
                await tx.workTask.update({ where: { id: task.id }, data: { status: "CANCELLED", reviewNotes: "El mantenimiento vinculado fue cerrado; se conserva el historial", reviewedByUserId: actorUserId, reviewedAt: new Date(), revision: { increment: 1 } } });
                await tx.workTaskEvent.create({ data: { taskId: task.id, actorUserId, action: "CANCELLED", notes: "Cierre del mantenimiento vinculado" } });
            }
        }
        // Closing a job never certifies the physical state of the vehicle.
        await tx.auditLog.create({
            data: {
                actorUserId, action: "MAINTENANCE_STATUS_CHANGED", entityType: "MaintenanceJob", entityId: id,
                metadata: { from: existing.status, to: input.status, assetId: existing.assetId },
            },
        });
        return tx.maintenanceJob.findUniqueOrThrow({ where: { id }, include });
    });
}
