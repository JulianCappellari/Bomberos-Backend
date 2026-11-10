"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.myEquipmentIssues = myEquipmentIssues;
exports.acceptEquipmentIssue = acceptEquipmentIssue;
const prisma_1 = require("../../config/prisma");
const transaction_1 = require("../../utils/transaction");
const operations_schemas_1 = require("../operations/operations.schemas");
const notifications_service_1 = require("./notifications.service");
async function myEquipmentIssues(userId) {
    return prisma_1.prisma.personalEquipmentIssue.findMany({ where: { userId, returnedAt: null }, select: { id: true, issuedAt: true, holderAcceptedAt: true, issueNotes: true, equipment: { select: { code: true, category: true, size: true, asset: { select: { name: true } } } } }, orderBy: [{ issuedAt: "desc" }, { id: "asc" }], take: 100 });
}
async function acceptEquipmentIssue(id, userId) {
    return (0, transaction_1.serializable)(async (tx) => {
        const row = await tx.personalEquipmentIssue.findFirst({ where: { id, userId, returnedAt: null }, include: { equipment: { include: { asset: true } } } });
        if (!row)
            throw new operations_schemas_1.OperationError(404, "Entrega no encontrada");
        if (row.holderAcceptedAt)
            return { acceptedAt: row.holderAcceptedAt };
        const acceptedAt = new Date();
        await tx.personalEquipmentIssue.update({ where: { id }, data: { holderAcceptedAt: acceptedAt } });
        await tx.auditLog.create({ data: { actorUserId: userId, action: "PERSONAL_EQUIPMENT_ACCEPTED", entityType: "PersonalEquipmentIssue", entityId: id, metadata: { equipmentId: row.equipmentId, code: row.equipment.code } } });
        await (0, notifications_service_1.notify)(tx, [row.issuedByUserId], `Entrega aceptada: ${row.equipment.asset.name}`, "/personal-equipment");
        return { acceptedAt };
    });
}
