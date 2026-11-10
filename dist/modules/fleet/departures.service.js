"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.departureSchema = void 0;
exports.listDepartures = listDepartures;
exports.recordDeparture = recordDeparture;
exports.voidDeparture = voidDeparture;
const node_crypto_1 = require("node:crypto");
const zod_1 = require("zod");
const prisma_1 = require("../../config/prisma");
const transaction_1 = require("../../utils/transaction");
const public_user_1 = require("../../utils/public-user");
const work_schemas_1 = require("../work/work.schemas");
const work_service_1 = require("../work/work.service");
const operations_schemas_1 = require("../operations/operations.schemas");
const notifications_service_1 = require("../members/notifications.service");
exports.departureSchema = zod_1.z.object({
    operationKey: zod_1.z.string().uuid(), assetId: zod_1.z.string().min(1), departedAt: zod_1.z.string().datetime({ offset: true }), returnedAt: zod_1.z.string().datetime({ offset: true }),
    purpose: zod_1.z.string().trim().min(5).max(200), notes: zod_1.z.string().trim().min(10).max(2000), leaderUserId: zod_1.z.string().min(1), userIds: zod_1.z.array(zod_1.z.string().min(1)).min(1).max(40),
}).strict().refine((v) => new Date(v.returnedAt) > new Date(v.departedAt), "La vuelta debe ser posterior a la salida").refine((v) => v.userIds.includes(v.leaderUserId) && new Set(v.userIds).size === v.userIds.length, "El encargado debe integrar una dotacion sin personas repetidas");
const include = { asset: { select: { id: true, name: true } }, createdBy: { select: public_user_1.PUBLIC_USER_SELECT }, crew: { include: { user: { select: public_user_1.PUBLIC_USER_SELECT } } } };
function manager(actor) { if (!(0, operations_schemas_1.isDutyManager)(actor.role))
    throw new operations_schemas_1.OperationError(403, "Solo mando autorizado registra actas de salida"); }
async function listDepartures(page, actor) {
    const where = (0, operations_schemas_1.isDutyManager)(actor.role) ? {} : { crew: { some: { userId: actor.userId } } };
    const [items, total] = await prisma_1.prisma.$transaction([prisma_1.prisma.vehicleDeparture.findMany({ where, include, orderBy: [{ departedAt: "desc" }, { id: "desc" }], skip: (page - 1) * 30, take: 30 }), prisma_1.prisma.vehicleDeparture.count({ where })], { isolationLevel: "RepeatableRead" });
    return { items: items.map(({ requestHash, operationKey, ...row }) => row), total, page, pageSize: 30 };
}
async function recordDeparture(input, actor) {
    manager(actor);
    const departedAt = (0, work_schemas_1.assertPast)(input.departedAt), returnedAt = (0, work_schemas_1.assertPast)(input.returnedAt);
    const requestHash = (0, node_crypto_1.createHash)("sha256").update(JSON.stringify({ ...input, userIds: [...input.userIds].sort() })).digest("hex");
    return (0, transaction_1.serializable)(async (tx) => {
        const previous = await tx.vehicleDeparture.findUnique({ where: { operationKey: input.operationKey } });
        if (previous) {
            if (previous.createdByUserId !== actor.userId || previous.requestHash !== requestHash)
                throw new operations_schemas_1.OperationError(409, "Clave de operacion utilizada para otra salida");
            return { id: previous.id, replayed: true };
        }
        const asset = await tx.asset.findFirst({ where: { id: input.assetId, assetType: "VEHICLE", deletedAt: null, vehicle: { isNot: null } }, select: { id: true, name: true } });
        if (!asset)
            throw new operations_schemas_1.OperationError(400, "Seleccione un movil vigente");
        await (0, work_service_1.activePeople)(tx, input.userIds);
        if (await tx.missionMovement.findFirst({ where: { departedAt: { lt: returnedAt }, OR: [{ returnedAt: null }, { returnedAt: { gt: departedAt } }], AND: [{ OR: [{ assetId: input.assetId }, { crew: { some: { userId: { in: input.userIds } } } }] }] } }))
            throw new operations_schemas_1.OperationError(409, "La salida se superpone con un despliegue de emergencia registrado");
        if (await tx.vehicleDeparture.findFirst({ where: { voidedAt: null, departedAt: { lt: returnedAt }, returnedAt: { gt: departedAt }, OR: [{ assetId: input.assetId }, { crew: { some: { userId: { in: input.userIds } } } }] } }))
            throw new operations_schemas_1.OperationError(409, "El movil o algun integrante tiene otra salida en ese horario");
        const row = await tx.vehicleDeparture.create({ data: { operationKey: input.operationKey, requestHash, assetId: input.assetId, departedAt, returnedAt, purpose: input.purpose, notes: input.notes, createdByUserId: actor.userId, crew: { create: input.userIds.map((userId) => ({ userId, isLeader: userId === input.leaderUserId })) } } });
        await tx.auditLog.create({ data: { actorUserId: actor.userId, action: "VEHICLE_DEPARTURE_RECORDED", entityType: "VehicleDeparture", entityId: row.id, metadata: { userIds: input.userIds, departedAt: departedAt.toISOString(), returnedAt: returnedAt.toISOString() } } });
        await (0, notifications_service_1.notify)(tx, input.userIds, `Salida registrada: ${asset.name}`, "/departures", "Las horas se agregan sin duplicar intervalos de guardias o permanencia. La permanencia en cuartel no fue cerrada.");
        return { id: row.id, replayed: false };
    });
}
async function voidDeparture(id, revision, reason, actor) {
    manager(actor);
    return (0, transaction_1.serializable)(async (tx) => {
        if (!(await tx.vehicleDeparture.updateMany({ where: { id, revision, voidedAt: null }, data: { voidedAt: new Date(), voidReason: reason, revision: { increment: 1 } } })).count)
            throw new operations_schemas_1.OperationError(409, "La salida cambio o ya fue anulada");
        await tx.auditLog.create({ data: { actorUserId: actor.userId, action: "VEHICLE_DEPARTURE_VOIDED", entityType: "VehicleDeparture", entityId: id, metadata: { reason } } });
        const members = await tx.departureMember.findMany({ where: { departureId: id }, select: { userId: true } });
        await (0, notifications_service_1.notify)(tx, members.map((m) => m.userId), "Acta de salida anulada", "/departures", reason);
        return { message: "Acta anulada; se conserva el historial y no se acreditan sus horas" };
    });
}
