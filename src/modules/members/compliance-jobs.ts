import { prisma } from "../../config/prisma";
import { shiftInterval } from "../shifts/shifts.rules";
import { messageFingerprint } from "../../utils/message-fingerprint";
import { commandUserIds } from "./notifications.service";

const HOUR = 3600000;
function interval(shift: { date: Date; period: string | null; startTime: string; endTime: string }) {
  const day = shift.date.toISOString().slice(0, 10);
  return shiftInterval(day, shift.period === "DAY" ? "08:00" : shift.period === "NIGHT" ? "20:00" : shift.startTime, shift.period === "DAY" ? "20:00" : shift.period === "NIGHT" ? "08:00" : shift.endTime);
}

// M03/M07: al terminar una guardia, quien estaba asignado y no tiene presencia QR coincidente con el
// turno queda con un incumplimiento registrado. No se modifica la guardia ni su historia.
export async function recordShiftAbsences(now = new Date()) {
  const shifts = await prisma.shift.findMany({ where: { date: { gte: new Date(now.getTime() - 3 * 86400000), lte: now } }, include: { assignments: true } });
  let recorded = 0;
  for (const shift of shifts) {
    const { start, end } = interval(shift);
    if (end > now.getTime()) continue;
    for (const { userId } of shift.assignments) {
      const key = `shift-absence:${shift.id}:${userId}`;
      if (await prisma.memberNotification.findUnique({ where: { dedupeKey: key }, select: { id: true } })) continue;
      const present = await prisma.attendance.findFirst({ where: { userId, checkInQrId: { not: null }, checkInTrust: { not: "REJECTED" }, discardedAt: null, checkInAt: { lt: new Date(end) }, OR: [{ status: "OPEN" }, { checkOutAt: { gt: new Date(start) } }] }, select: { id: true } });
      if (present) continue;
      await prisma.$transaction(async tx => {
        const created = await tx.memberNotification.createMany({ data: [{ userId, dedupeKey: key, title: `Inasistencia registrada a la guardia del ${shift.date.toISOString().slice(0, 10)}`, href: "/calendar", body: "No consta presencia QR durante el turno asignado. Si fue un error, solicite la corrección a jefatura." }], skipDuplicates: true });
        if (!created.count) return;
        await tx.auditLog.create({ data: { action: "SYSTEM_SHIFT_ABSENCE_RECORDED", entityType: "Shift", entityId: shift.id, metadata: { userId, start: new Date(start).toISOString(), end: new Date(end).toISOString() } } });
        const command = await commandUserIds(tx);
        await tx.memberNotification.createMany({ data: command.map(id => ({ userId: id, dedupeKey: `shift-absence-command:${shift.id}:${userId}:${id}`, title: "Inasistencia a guardia obligatoria", href: "/calendar", body: `Guardia del ${shift.date.toISOString().slice(0, 10)} (${shift.shiftType})` })), skipDuplicates: true });
        recorded++;
      });
    }
  }
  return recorded;
}

// N03/N06: todos los mensajes requieren acuse; a las 24 horas se recuerda una vez a quien no confirmo
// la version vigente. Si el mensaje se edita, el recordatorio corresponde a la nueva version.
export async function remindUnacknowledgedMessages(now = new Date()) {
  const messages = await prisma.chatMessage.findMany({ where: { deletedAt: null, createdAt: { gte: new Date(now.getTime() - 7 * 86400000), lte: new Date(now.getTime() - 24 * HOUR) } }, select: { id: true, body: true, createdAt: true, editedAt: true, authorUserId: true }, take: 200 });
  if (!messages.length) return 0;
  const people = await prisma.user.findMany({ where: { isActive: true, isPendingApproval: false, deletedAt: null }, select: { id: true, createdAt: true } });
  let reminded = 0;
  for (const message of messages) {
    if (message.editedAt && now.getTime() - message.editedAt.getTime() < 24 * HOUR) continue;
    const hash = messageFingerprint(message);
    const acknowledged = new Set((await prisma.chatAcknowledgement.findMany({ where: { messageId: message.id, contentHash: hash }, select: { userId: true } })).map(row => row.userId));
    const pending = people.filter(person => person.id !== message.authorUserId && !acknowledged.has(person.id) && person.createdAt <= (message.editedAt || message.createdAt));
    if (!pending.length) continue;
    const result = await prisma.memberNotification.createMany({ data: pending.map(person => ({ userId: person.id, dedupeKey: `ack-reminder:${message.id}:${hash.slice(0, 16)}:${person.id}`, title: "Recordatorio: confirme la lectura de un comunicado", href: "/chat", body: message.body.slice(0, 300) })), skipDuplicates: true });
    reminded += result.count;
  }
  return reminded;
}

export function startComplianceJobs() {
  let running = false;
  async function run() {
    if (running) return;
    running = true;
    try { await recordShiftAbsences(); await remindUnacknowledgedMessages(); }
    catch { console.error("No se pudieron completar los controles de guardias y acuses; se reintentará"); }
    finally { running = false; }
  }
  void run();
  const timer = setInterval(() => void run(), 5 * 60000); timer.unref();
  return () => clearInterval(timer);
}
