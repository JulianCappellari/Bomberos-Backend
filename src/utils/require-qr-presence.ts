import { Prisma } from "@prisma/client";
import { OperationError } from "../modules/operations/operations.schemas";

export async function requireQrPresence(tx: Prisma.TransactionClient, userId: string) {
  if (await tx.missionCrew.findFirst({ where: { userId, movement: { returnedAt: null } }, select: { userId: true } })) throw new OperationError(403, "Durante una salida a intervencion no puede realizar tareas o controles en el cuartel");
  const presence = await tx.attendance.findFirst({
    where: { userId, status: "OPEN", checkInQrId: { not: null }, checkInAt: { lte: new Date() }, checkInTrust: { not: "REJECTED" } },
    select: { id: true },
  });
  if (!presence) throw new OperationError(403, "Debe registrar su ingreso al cuartel mediante QR antes de realizar esta accion");
}
