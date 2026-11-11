"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordShiftAbsences = recordShiftAbsences;
exports.remindUnacknowledgedMessages = remindUnacknowledgedMessages;
exports.startComplianceJobs = startComplianceJobs;
const station_service_1 = require("../station/station.service");
const chat_audience_1 = require("../chat/chat-audience");
const prisma_1 = require("../../config/prisma");
const shifts_rules_1 = require("../shifts/shifts.rules");
const message_fingerprint_1 = require("../../utils/message-fingerprint");
const notifications_service_1 = require("./notifications.service");
const HOUR = 3600000;
function interval(shift) {
    const day = shift.date.toISOString().slice(0, 10);
    return (0, shifts_rules_1.shiftInterval)(day, shift.period === "DAY" ? "08:00" : shift.period === "NIGHT" ? "20:00" : shift.startTime, shift.period === "DAY" ? "20:00" : shift.period === "NIGHT" ? "08:00" : shift.endTime);
}
// M03/M07: al terminar una guardia, quien estaba asignado y no tiene presencia QR coincidente con el
// turno queda con un incumplimiento registrado. No se modifica la guardia ni su historia.
async function recordShiftAbsences(now = new Date()) {
    // 4 dias: la fecha de la guardia se guarda a medianoche UTC y en Argentina (UTC-3) una ventana de 3 dias dejaba afuera guardias recientes despues de las 21 h.
    const shifts = await prisma_1.prisma.shift.findMany({ where: { date: { gte: new Date(now.getTime() - 4 * 86400000), lte: now } }, include: { assignments: true } });
    let recorded = 0;
    for (const shift of shifts) {
        const { start, end } = interval(shift);
        if (end > now.getTime())
            continue;
        for (const { userId } of shift.assignments) {
            const key = `shift-absence:${shift.id}:${userId}`;
            if (await prisma_1.prisma.memberNotification.findUnique({ where: { dedupeKey: key }, select: { id: true } }))
                continue;
            const present = await prisma_1.prisma.attendance.findFirst({ where: { userId, checkInQrId: { not: null }, checkInTrust: { not: "REJECTED" }, discardedAt: null, checkInAt: { lt: new Date(end) }, OR: [{ status: "OPEN" }, { checkOutAt: { gt: new Date(start) } }] }, select: { id: true } });
            if (present)
                continue;
            // Fecha legible y nombre de la persona: sin nombre, jefatura recibia avisos identicos imposibles de distinguir.
            const day = new Intl.DateTimeFormat("es-AR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(shift.date);
            const turn = shift.period === "DAY" ? "diurno" : shift.period === "NIGHT" ? "nocturno" : shift.shiftType;
            const person = await prisma_1.prisma.user.findUnique({ where: { id: userId }, select: { username: true, profile: { select: { fullName: true } } } });
            const who = person?.profile?.fullName || person?.username || "Integrante";
            await prisma_1.prisma.$transaction(async (tx) => {
                const created = await tx.memberNotification.createMany({ data: [{ userId, dedupeKey: key, title: `Inasistencia registrada: guardia del ${day}`, href: "/calendar", body: "No consta presencia QR durante el turno asignado. Si fue un error, solicite la corrección a jefatura." }], skipDuplicates: true });
                if (!created.count)
                    return;
                await tx.auditLog.create({ data: { action: "SYSTEM_SHIFT_ABSENCE_RECORDED", entityType: "Shift", entityId: shift.id, metadata: { userId, start: new Date(start).toISOString(), end: new Date(end).toISOString() } } });
                const command = await (0, notifications_service_1.commandUserIds)(tx);
                await tx.memberNotification.createMany({ data: command.map(id => ({ userId: id, dedupeKey: `shift-absence-command:${shift.id}:${userId}:${id}`, title: `Inasistencia: ${who}`, href: "/calendar", body: `Sin presencia QR en la guardia del ${day}, turno ${turn}.` })), skipDuplicates: true });
                recorded++;
            });
        }
    }
    return recorded;
}
// N03/N06: todos los mensajes requieren acuse; a las 24 horas se recuerda una vez a quien no confirmo
// la version vigente. Si el mensaje se edita, el recordatorio corresponde a la nueva version.
async function remindUnacknowledgedMessages(now = new Date()) {
    const messages = await prisma_1.prisma.chatMessage.findMany({ where: { deletedAt: null, createdAt: { gte: new Date(now.getTime() - 7 * 86400000), lte: new Date(now.getTime() - 24 * HOUR) } }, select: { id: true, body: true, createdAt: true, editedAt: true, authorUserId: true, audience: true }, take: 200 });
    if (!messages.length)
        return 0;
    // El administrador tecnico no confirma lectura de comunicaciones.
    const people = await prisma_1.prisma.user.findMany({ where: { isActive: true, isPendingApproval: false, deletedAt: null, NOT: { profile: { rank: { equals: "Administrador", mode: "insensitive" } } } }, select: { id: true, createdAt: true } });
    let reminded = 0;
    for (const message of messages) {
        if (message.editedAt && now.getTime() - message.editedAt.getTime() < 24 * HOUR)
            continue;
        const hash = (0, message_fingerprint_1.messageFingerprint)(message);
        const acknowledged = new Set((await prisma_1.prisma.chatAcknowledgement.findMany({ where: { messageId: message.id, contentHash: hash }, select: { userId: true } })).map(row => row.userId));
        const members = message.audience === "ALL" ? null : new Set(await (0, chat_audience_1.audienceMemberIds)(prisma_1.prisma, message.audience));
        const pending = people.filter(person => person.id !== message.authorUserId && (!members || members.has(person.id)) && !acknowledged.has(person.id) && person.createdAt <= (message.editedAt || message.createdAt));
        if (!pending.length)
            continue;
        const result = await prisma_1.prisma.memberNotification.createMany({ data: pending.map(person => ({ userId: person.id, dedupeKey: `ack-reminder:${message.id}:${hash.slice(0, 16)}:${person.id}`, title: "Recordatorio: confirme la lectura de un comunicado", href: "/chat", body: message.body.slice(0, 300) })), skipDuplicates: true });
        reminded += result.count;
    }
    return reminded;
}
function startComplianceJobs() {
    let running = false;
    async function run() {
        if (running)
            return;
        running = true;
        try {
            await recordShiftAbsences();
            await remindUnacknowledgedMessages();
            await (0, station_service_1.remindUpcomingEvents)();
        }
        catch {
            console.error("No se pudieron completar los controles de guardias y acuses; se reintentará");
        }
        finally {
            running = false;
        }
    }
    void run();
    const timer = setInterval(() => void run(), 5 * 60000);
    timer.unref();
    return () => clearInterval(timer);
}
