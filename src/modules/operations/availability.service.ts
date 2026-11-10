import { z } from "zod";
import { prisma } from "../../config/prisma";
import { serializable } from "../../utils/transaction";
import { PUBLIC_USER_SELECT } from "../../utils/public-user";
import { availabilitySchema, isOperationsManager, OperationError } from "./operations.schemas";
import { stationDate } from "../../utils/station-time";
export { stationDate } from "../../utils/station-time";

export async function listAvailability(date: string, actor: { userId: string; role: string }) {
  const rows = await prisma.personnelAvailability.findMany({
    where: {
      date: new Date(date + "T00:00:00Z"),
      user: { isActive: true, isPendingApproval: false, deletedAt: null },
    },
    include: { user: { select: PUBLIC_USER_SELECT } },
    orderBy: [{ period: "asc" }, { updatedAt: "desc" }],
  });
  return rows.map((row) => ({
    ...row,
    notes: isOperationsManager(actor.role) || row.userId === actor.userId ? row.notes : null,
  }));
}
export async function saveAvailability(input: z.infer<typeof availabilitySchema>, actor: { userId: string; role: string }) {
  const userId = input.userId || actor.userId;
  if (userId !== actor.userId && !isOperationsManager(actor.role)) {
    throw new OperationError(403, "Solo puede modificar su propia disponibilidad");
  }
  if (input.date < stationDate()) throw new OperationError(400, "No se puede modificar disponibilidad de dias anteriores");
  return serializable(async (tx) => {
    const user = await tx.user.findFirst({
      where: { id: userId, isActive: true, isPendingApproval: false, deletedAt: null }, select: { id: true },
    });
    if (!user) throw new OperationError(404, "Personal no habilitado");
    const date = new Date(input.date + "T00:00:00Z");
    if (input.status === "UNAVAILABLE") {
      const assigned = await tx.shift.findFirst({
        where: { date, period: input.period, assignments: { some: { userId } } }, select: { id: true },
      });
      if (assigned) throw new OperationError(409, "Ya esta asignado a una guardia. Solicite al responsable modificar la dotacion primero.");
    }
    const existing = await tx.personnelAvailability.findUnique({
      where: { userId_date_period: { userId, date, period: input.period } },
    });
    if ((existing?.revision || 0) !== input.revision) throw new OperationError(409, "La disponibilidad cambio. Recargue antes de guardar.");
    const data = { status: input.status, notes: input.notes || null, editedByUserId: actor.userId };
    const record = existing
      ? await tx.personnelAvailability.update({
        where: { id: existing.id, revision: input.revision },
        data: { ...data, revision: { increment: 1 } },
      })
      : await tx.personnelAvailability.create({ data: { ...data, userId, date, period: input.period } });
    await tx.auditLog.create({
      data: {
        actorUserId: actor.userId, action: "AVAILABILITY_UPDATED", entityType: "PersonnelAvailability",
        entityId: record.id, metadata: { userId, date: input.date, period: input.period, status: input.status },
      },
    });
    return record;
  });
}
