import { z } from "zod";
import { prisma } from "../../config/prisma";
import { serializable } from "../../utils/transaction";
import { PUBLIC_USER_SELECT } from "../../utils/public-user";
import { notify } from "../members/notifications.service";
import { maintenanceSchema, maintenanceTransitionSchema, assertMaintenanceTransition, isDutyManager, OperationError } from "./operations.schemas";

const include = {
  publicTask: { select: { id: true, status: true } },
  asset: { select: { id: true, name: true, status: true, assetType: true } },
  responsible: { select: PUBLIC_USER_SELECT },
  createdBy: { select: PUBLIC_USER_SELECT },
} as const;
export async function publishMaintenanceTask(id: string, actorUserId: string) {
  return serializable(async (tx) => {
    const job = await tx.maintenanceJob.findUnique({ where: { id }, include });
    if (!job || !["OPEN", "IN_PROGRESS"].includes(job.status)) throw new OperationError(409, "Solo se publican trabajos de mantenimiento abiertos");
    if (job.publicTask) return { id: job.publicTask.id, existing: true };
    const task = await tx.workTask.create({ data: { title: `Mantenimiento: ${job.title}`.slice(0, 160), description: `${job.asset.name}: ${job.description}`.slice(0, 4000), dueOn: job.dueAt, maintenanceJobId: id, createdByUserId: actorUserId } });
    await tx.auditLog.create({ data: { actorUserId, action: "MAINTENANCE_TASK_CREATED", entityType: "WorkTask", entityId: task.id, metadata: { maintenanceJobId: id } } });
    return { id: task.id, existing: false };
  });
}
export async function listMaintenance(filters: { assetId?: string; status?: "OPEN" | "IN_PROGRESS" | "RESOLVED" | "CANCELLED" }, role: string) {
  if (!isDutyManager(role)) throw new OperationError(403, "Modulo reservado a mando o guardia");
  const rows = await prisma.maintenanceJob.findMany({
    where: { ...filters }, include,
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
  });
  return rows.map((row) => ({ ...row, costCents: isDutyManager(role) ? row.costCents : null }));
}
export async function createMaintenance(input: z.infer<typeof maintenanceSchema>, actorUserId: string) {
  return serializable(async (tx) => {
    const asset = await tx.asset.findFirst({ where: { id: input.assetId, deletedAt: null } });
    if (!asset) throw new OperationError(404, "Vehiculo o equipo no encontrado");
    if (input.responsibleUserId) {
      const responsible = await tx.user.findFirst({
        where: { id: input.responsibleUserId, isActive: true, isPendingApproval: false, deletedAt: null }, select: { id: true },
      });
      if (!responsible) throw new OperationError(400, "El responsable no esta habilitado");
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
      if (input.responsibleUserId) await notify(tx, [input.responsibleUserId], `Tarea de mantenimiento: ${input.title}`, "/tasks");
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
export async function transitionMaintenance(id: string, input: z.infer<typeof maintenanceTransitionSchema>, actorUserId: string) {
  return serializable(async (tx) => {
    const existing = await tx.maintenanceJob.findUnique({ where: { id } });
    if (!existing) throw new OperationError(404, "Trabajo no encontrado");
    assertMaintenanceTransition(existing.status, input.status);
    const changed = await tx.maintenanceJob.updateMany({
      where: { id, revision: input.revision, status: existing.status },
      data: {
        status: input.status, resolution: input.resolution || null, costCents: input.costCents ?? null,
        resolvedAt: ["RESOLVED", "CANCELLED"].includes(input.status) ? new Date() : null,
        revision: { increment: 1 },
      },
    });
    if (!changed.count) throw new OperationError(409, "El trabajo cambio. Recargue antes de continuar.");
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
