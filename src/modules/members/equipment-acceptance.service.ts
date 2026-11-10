import { prisma } from "../../config/prisma";
import { serializable } from "../../utils/transaction";
import { OperationError } from "../operations/operations.schemas";
import { notify } from "./notifications.service";

export async function myEquipmentIssues(userId: string) {
  return prisma.personalEquipmentIssue.findMany({ where: { userId, returnedAt: null }, select: { id: true, issuedAt: true, holderAcceptedAt: true, issueNotes: true, equipment: { select: { code: true, category: true, size: true, asset: { select: { name: true } } } } }, orderBy: [{ issuedAt: "desc" }, { id: "asc" }], take: 100 });
}
export async function acceptEquipmentIssue(id: string, userId: string) {
  return serializable(async tx => {
    const row = await tx.personalEquipmentIssue.findFirst({ where: { id, userId, returnedAt: null }, include: { equipment: { include: { asset: true } } } });
    if (!row) throw new OperationError(404, "Entrega no encontrada");
    if (row.holderAcceptedAt) return { acceptedAt: row.holderAcceptedAt };
    const acceptedAt = new Date();
    await tx.personalEquipmentIssue.update({ where: { id }, data: { holderAcceptedAt: acceptedAt } });
    await tx.auditLog.create({ data: { actorUserId: userId, action: "PERSONAL_EQUIPMENT_ACCEPTED", entityType: "PersonalEquipmentIssue", entityId: id, metadata: { equipmentId: row.equipmentId, code: row.equipment.code } } });
    await notify(tx, [row.issuedByUserId], `Entrega aceptada: ${row.equipment.asset.name}`, "/personal-equipment");
    return { acceptedAt };
  });
}
