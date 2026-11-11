import { Prisma } from "@prisma/client";
import { notifyCommand } from "../modules/members/notifications.service";

// T09: senales tipicas de una ubicacion fabricada. No bloquean por si solas (un GPS real puede
// coincidir); marcan la sospecha, la auditan y la informan a jefatura para su revision.
export function gpsSuspicionReasons(input: { latitude: number; longitude: number; accuracy?: number | null }, previous?: { latitude: number | null; longitude: number | null } | null) {
  const reasons: string[] = [];
  if (typeof input.accuracy === "number" && input.accuracy < 1) reasons.push("Precisión informada inferior a 1 metro");
  const decimals = (value: number) => (String(value).split(".")[1] || "").length;
  if (decimals(input.latitude) <= 3 && decimals(input.longitude) <= 3) reasons.push("Coordenadas redondeadas");
  if (previous?.latitude === input.latitude && previous?.longitude === input.longitude) reasons.push("Coordenadas idénticas a la verificación anterior");
  return reasons;
}
export async function recordSharedDevice(tx: Prisma.TransactionClient, userId: string, attendanceId: string, device?: string | null) {
  if (!device) return;
  const since = new Date(Date.now() - 12 * 3_600_000);
  const others = await tx.attendance.findMany({ where: { userId: { not: userId }, OR: [{ checkInDevice: device, checkInAt: { gt: since } }, { checkOutDevice: device, checkOutAt: { gt: since } }] }, select: { userId: true }, distinct: ["userId"], take: 5 });
  if (!others.length) return;
  await tx.attendance.update({ where: { id: attendanceId }, data: { checkInTrust: "MEDIUM" } });
  await tx.auditLog.create({ data: { actorUserId: userId, action: "ATTENDANCE_SHARED_DEVICE", entityType: "Attendance", entityId: attendanceId, metadata: { otherUserIds: others.map((o) => o.userId) } } });
  await notifyCommand(tx, "Mismo celular usado por varias personas para fichar", "/security-center", "Un ingreso por QR se hizo desde un celular que en las últimas 12 horas fichó a otra persona. Revisá si alguien está fichando por otro.", userId);
}
export async function recordGpsSuspicion(tx: Prisma.TransactionClient, userId: string, attendanceId: string, context: string, reasons: string[]) {
  if (!reasons.length) return;
  await tx.auditLog.create({ data: { actorUserId: userId, action: "PRESENCE_GPS_SUSPICIOUS", entityType: "Attendance", entityId: attendanceId, metadata: { context, reasons } } });
  await notifyCommand(tx, "Ubicación sospechosa en un registro de presencia", "/station", `${context}: ${reasons.join("; ")}`, userId);
}
