"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.stationDate = void 0;
exports.listAvailability = listAvailability;
exports.saveAvailability = saveAvailability;
const prisma_1 = require("../../config/prisma");
const transaction_1 = require("../../utils/transaction");
const public_user_1 = require("../../utils/public-user");
const operations_schemas_1 = require("./operations.schemas");
const station_time_1 = require("../../utils/station-time");
var station_time_2 = require("../../utils/station-time");
Object.defineProperty(exports, "stationDate", { enumerable: true, get: function () { return station_time_2.stationDate; } });
async function listAvailability(date, actor) {
    const rows = await prisma_1.prisma.personnelAvailability.findMany({
        where: {
            date: new Date(date + "T00:00:00Z"),
            user: { isActive: true, isPendingApproval: false, deletedAt: null },
        },
        include: { user: { select: public_user_1.PUBLIC_USER_SELECT } },
        orderBy: [{ period: "asc" }, { updatedAt: "desc" }],
    });
    return rows.map((row) => ({
        ...row,
        notes: (0, operations_schemas_1.isOperationsManager)(actor.role) || row.userId === actor.userId ? row.notes : null,
    }));
}
async function saveAvailability(input, actor) {
    const userId = input.userId || actor.userId;
    if (userId !== actor.userId && !(0, operations_schemas_1.isOperationsManager)(actor.role)) {
        throw new operations_schemas_1.OperationError(403, "Solo puede modificar su propia disponibilidad");
    }
    if (input.date < (0, station_time_1.stationDate)())
        throw new operations_schemas_1.OperationError(400, "No se puede modificar disponibilidad de dias anteriores");
    return (0, transaction_1.serializable)(async (tx) => {
        const user = await tx.user.findFirst({
            where: { id: userId, isActive: true, isPendingApproval: false, deletedAt: null }, select: { id: true },
        });
        if (!user)
            throw new operations_schemas_1.OperationError(404, "Personal no habilitado");
        const date = new Date(input.date + "T00:00:00Z");
        if (input.status === "UNAVAILABLE") {
            const assigned = await tx.shift.findFirst({
                where: { date, period: input.period, assignments: { some: { userId } } }, select: { id: true },
            });
            if (assigned)
                throw new operations_schemas_1.OperationError(409, "Ya esta asignado a una guardia. Solicite al responsable modificar la dotacion primero.");
        }
        const existing = await tx.personnelAvailability.findUnique({
            where: { userId_date_period: { userId, date, period: input.period } },
        });
        if ((existing?.revision || 0) !== input.revision)
            throw new operations_schemas_1.OperationError(409, "La disponibilidad cambio. Recargue antes de guardar.");
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
