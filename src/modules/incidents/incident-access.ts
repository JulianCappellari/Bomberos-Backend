import { Prisma } from "@prisma/client";
import { requireQrPresence } from "../../utils/require-qr-presence";

type Actor = { userId: string; role: string };

// Authentication resolves both the administrator and official to ADMIN.
// Writing a report does not certify attendance or change an alert response.
export async function canWriteIncident(tx: Prisma.TransactionClient, actor: Actor) {
  if (actor.role === "ADMIN") return true;
  return Boolean(await tx.attendance.findFirst({ where: {
    userId: actor.userId, status: "OPEN", checkInQrId: { not: null }, checkInAt: { lte: new Date() }, checkInTrust: { not: "REJECTED" },
    user: { missionCrew: { none: { movement: { returnedAt: null } } } },
  }, select: { id: true } }));
}

export async function requireIncidentWrite(tx: Prisma.TransactionClient, actor: Actor) {
  if (actor.role !== "ADMIN") await requireQrPresence(tx, actor.userId);
}
