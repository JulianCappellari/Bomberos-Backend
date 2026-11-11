import { Prisma } from "@prisma/client";
import { requireQrPresence } from "../../utils/require-qr-presence";

type Actor = { userId: string; role: string };

// Authentication resolves both the administrator and official to ADMIN.
// Writing a report does not certify attendance or change an alert response.
// La guardia de turno (cuenta de guardia) completa la planilla desde el cuartel: su cuenta no ficha
// con QR (para no sumar asistencia personal), asi que queda exceptuada como administracion y oficiales.
const exempt = (role: string) => role === "ADMIN" || role === "GUARD";

export async function canWriteIncident(tx: Prisma.TransactionClient, actor: Actor) {
  if (exempt(actor.role)) return true;
  return Boolean(await tx.attendance.findFirst({ where: {
    userId: actor.userId, status: "OPEN", checkInQrId: { not: null }, checkInAt: { lte: new Date() }, checkInTrust: { not: "REJECTED" },
    user: { missionCrew: { none: { movement: { returnedAt: null } } } },
  }, select: { id: true } }));
}

export async function requireIncidentWrite(tx: Prisma.TransactionClient, actor: Actor) {
  if (!exempt(actor.role)) await requireQrPresence(tx, actor.userId);
}
