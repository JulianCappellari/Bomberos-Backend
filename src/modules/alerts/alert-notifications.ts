import { Prisma } from "@prisma/client";
import { commandUserIds } from "../members/notifications.service";
const label = (priority: string) => priority === "HIGH" ? "alta" : priority === "MEDIUM" ? "media" : "baja";
// D01/D03: solo se convoca a quien confirmo disponibilidad y no tiene una ausencia vigente.
// F13: una alerta critica (prioridad alta) se informa siempre a jefatura, aunque no este disponible;
// ese aviso es informativo y no la convierte en destinataria de la convocatoria (F09).
export async function notifyAlert(tx: Prisma.TransactionClient, alert: { id: string; priority: string }, userId?: string) {
  const now = new Date();
  const users = await tx.user.findMany({
    where: {
      ...(userId ? { id: userId } : {}),
      isActive: true,
      isPendingApproval: false,
      deletedAt: null,
      emergencyStatusConfirmedAt: { not: null },
      emergencyAvailability: {
        none: {
          cancelledAt: null,
          startsAt: { lte: now },
          OR: [{ endsAt: null }, { endsAt: { gt: now } }],
        },
      },
    },
    select: { id: true },
  });
  await tx.memberNotification.createMany({ data: users.map(user => ({ userId: user.id, title: `Nueva alerta operativa: prioridad ${label(alert.priority)}`, href: "/alerts", dedupeKey: `alert:${alert.id}:${user.id}` })), skipDuplicates: true });
  if (!userId && alert.priority === "HIGH") {
    const recipients = new Set(users.map(user => user.id));
    const command = (await commandUserIds(tx)).filter(id => !recipients.has(id));
    await tx.memberNotification.createMany({ data: command.map(id => ({ userId: id, title: "Alerta crítica emitida (aviso a jefatura)", href: "/alerts", body: "Aviso informativo: usted no figura disponible, por lo que no integra la convocatoria.", dedupeKey: `alert-command:${alert.id}:${id}` })), skipDuplicates: true });
  }
}
// F09: destinataria es la persona a la que se le entrego la convocatoria de esa alerta.
export async function isAlertRecipient(tx: Prisma.TransactionClient, alertId: string, userId: string) {
  return Boolean(await tx.memberNotification.findUnique({ where: { dedupeKey: `alert:${alertId}:${userId}` }, select: { id: true } }));
}
