import { sanitizeTaskPhotos } from "../work/work-photos";
import { prisma } from "../../config/prisma";
import { lockRow } from "../../utils/database-schema";
import { isCommandRank, effectiveAccessRole } from "../../utils/firefighter-ranks";
import { OperationError } from "../operations/operations.schemas";
import { serializable } from "../../utils/transaction";
import { assertCanSendTo, audienceMemberIds, visibleAudiences, type ChatAudience } from "./chat-audience";

const VOTER_SELECT = { id: true, username: true, profile: { select: { fullName: true } } } as const;
const MESSAGE_INCLUDE = {
  attachments: { select: { id: true }, orderBy: { createdAt: "asc" as const } },
  poll: {
    include: {
      options: { orderBy: { position: "asc" as const }, include: { votes: { orderBy: { votedAt: "asc" as const }, select: { userId: true, votedAt: true, user: { select: VOTER_SELECT } } } } },
    },
  },
  author: {
    select: {
      id: true,
      username: true,
      role: true,
      profile: {
        select: {
          fullName: true,
          rank: true,
          badge: true,
          avatarUrl: true,
        },
      },
    },
  },
};

async function getActorRank(actorUserId: string) {
  const actor = await prisma.user.findFirst({
    where: {
      id: actorUserId,
      deletedAt: null,
      isActive: true,
      isPendingApproval: false,
    },
    select: {
      role: true,
      profile: {
        select: {
          rank: true,
        },
      },
    },
  });

  if (!actor) return null;
  const role = effectiveAccessRole(actor.role, actor.profile?.rank);
  return role === "ADMIN" ? "Administrador" : role === "OPERATOR" ? "Sub oficial" : actor.profile?.rank ?? null;
}

async function assertCommandRank(actorUserId: string, sessionRole?: string) {
  if (sessionRole && !["ADMIN","OPERATOR"].includes(sessionRole)) throw new OperationError(403,"El modo de sesión no permite moderar comunicaciones");
  const actorRank = await getActorRank(actorUserId);

  if (!isCommandRank(actorRank)) {
    throw new OperationError(403, "Solo oficial, suboficial o administrador puede moderar comunicaciones");
  }
}

export async function listChatMessages(data: {
  limit: number;
  before?: string;
  actorUserId: string;
}) {
  const audiences = await visibleAudiences(prisma, data.actorUserId);
  return prisma.chatMessage.findMany({
    where: {
      deletedAt: null,
      OR: [{ audience: { in: audiences } }, { authorUserId: data.actorUserId }],
      ...(data.before
        ? {
            createdAt: {
              lt: new Date(data.before),
            },
          }
        : {}),
    },
    include: MESSAGE_INCLUDE,
    orderBy: [{ isPinned: "desc" }, { createdAt: "desc" }],
    take: data.limit,
  });
}

export async function createChatMessage(data: {
  body: string;
  authorUserId: string;
  audience?: ChatAudience;
  poll?: { options: string[]; allowMultiple: boolean };
  photos?: string[];
  links?: string[];
}) {
  // Las fotos se validan y recomprimen fuera de la transaccion (mismo filtro que las fotos de tareas).
  const photos = data.photos?.length ? await sanitizeTaskPhotos(data.photos) : [];
  const links = [...new Set(data.links ?? [])];
  return serializable(async (prisma) => {
  const audience = data.audience ?? "ALL";
  await assertCanSendTo(prisma, data.authorUserId, audience);
  const message = await prisma.chatMessage.create({
    data: {
      body: data.body,
      authorUserId: data.authorUserId,
      audience,
      links,
      ...(photos.length ? { attachments: { create: photos.map((p) => ({ bytes: p.bytes, sha256: p.sha256 })) } } : {}),
      ...(data.poll ? { poll: { create: { allowMultiple: data.poll.allowMultiple, options: { create: data.poll.options.map((text, position) => ({ text, position })) } } } } : {}),
    },
    include: MESSAGE_INCLUDE,
  });

  await prisma.auditLog.create({
    data: {
      actorUserId: data.authorUserId,
      action: "CHAT_MESSAGE_CREATED",
      entityType: "ChatMessage",
      entityId: message.id,
      metadata: {
        bodyLength: data.body.length,
        audience,
        photos: photos.length,
        links,
        ...(data.poll ? { poll: { options: data.poll.options, allowMultiple: data.poll.allowMultiple } } : {}),
      },
    },
  });
  // Un mensaje a un grupo se avisa a sus integrantes; los generales se ven en Comunicaciones.
  if (audience !== "ALL") {
    const members = (await audienceMemberIds(prisma, audience)).filter((id) => id !== data.authorUserId);
    if (members.length) await prisma.memberNotification.createMany({ data: members.map((userId) => ({ userId, title: data.poll ? "Nueva encuesta para tu grupo" : "Nuevo mensaje para tu grupo", href: "/chat", body: (data.body || (photos.length ? "Foto" : "Link")).slice(0, 300) })) });
  }

  return message;
  });
}

export async function updateChatMessage(data: {
  messageId: string;
  actorUserId: string;
  actorRole?: string;
  body: string;
}) {
  return serializable(async (prisma) => {
  await lockRow(prisma, "ChatMessage", data.messageId);
  const message = await prisma.chatMessage.findFirst({
    where: {
      id: data.messageId,
      deletedAt: null,
    },
    select: {
      id: true,
      authorUserId: true,
      editedAt: true,
      createdAt: true,
      body: true,
      audience: true,
    },
  });

  if (!message) {
    throw new OperationError(404, "Mensaje no encontrado");
  }

  // N02: nadie edita mensajes ajenos; solo su autor.
  if (message.authorUserId !== data.actorUserId) throw new OperationError(403, "Solo el autor puede editar su mensaje");
  // Como en WhatsApp, una encuesta no se edita (cambiaria el sentido de los votos ya emitidos).
  if (await prisma.chatPoll.findUnique({ where: { messageId: message.id }, select: { id: true } })) throw new OperationError(409, "Las encuestas no se editan. Cerrala y creá una nueva si hace falta");

  const updated = await prisma.chatMessage.update({
    where: { id: data.messageId },
    data: {
      body: data.body,
      editedAt: new Date(Math.max(Date.now(), (message.editedAt || message.createdAt).getTime() + 1)),
    },
    include: MESSAGE_INCLUDE,
  });

  await prisma.auditLog.create({
    data: {
      actorUserId: data.actorUserId,
      action: "CHAT_MESSAGE_UPDATED",
      entityType: "ChatMessage",
      entityId: updated.id,
      metadata: {
        bodyLength: data.body.length,
        before: message.body,
        after: data.body,
        authorUserId: message.authorUserId,
      },
    },
  });
  // N05: al editar se restablece el acuse de todos (el acuse queda ligado al contenido) y se avisa
  // a todo el personal para que vuelva a leer y confirmar.
  if (message.body !== data.body) {
    const people = (await audienceMemberIds(prisma, message.audience)).filter((id) => id !== data.actorUserId).map((id) => ({ id }));
    await prisma.memberNotification.createMany({ data: people.map((person) => ({ userId: person.id, title: "Un mensaje fue editado: vuelva a leerlo y confirme la lectura", href: "/chat", body: data.body.slice(0, 300) })) });
  }

  return updated;
  });
}

export async function deleteChatMessage(data: {
  messageId: string;
  actorUserId: string;
  actorRole?: string;
}) {
  return serializable(async (prisma) => {
  await lockRow(prisma, "ChatMessage", data.messageId);

  const message = await prisma.chatMessage.findFirst({
    where: {
      id: data.messageId,
      deletedAt: null,
    },
    select: {
      id: true,
      authorUserId: true,
    },
  });

  if (!message) {
    throw new Error("Mensaje no encontrado");
  }
  if (message.authorUserId !== data.actorUserId) await assertCommandRank(data.actorUserId,data.actorRole);

  const deleted = await prisma.chatMessage.update({
    where: { id: data.messageId },
    data: {
      deletedAt: new Date(),
      isPinned: false,
    },
    include: MESSAGE_INCLUDE,
  });

  await prisma.auditLog.create({
    data: {
      actorUserId: data.actorUserId,
      action: "CHAT_MESSAGE_DELETED",
      entityType: "ChatMessage",
      entityId: deleted.id,
      metadata: {
        authorUserId: message.authorUserId,
      },
    },
  });

  return { message: "Mensaje eliminado" };
  });
}

export async function setChatMessagePinned(data: {
  messageId: string;
  actorUserId: string;
  actorRole?: string;
  isPinned: boolean;
}) {
  await assertCommandRank(data.actorUserId,data.actorRole);
  return serializable(async (prisma) => {
  await lockRow(prisma, "ChatMessage", data.messageId);

  const message = await prisma.chatMessage.findFirst({
    where: {
      id: data.messageId,
      deletedAt: null,
    },
    select: {
      id: true,
    },
  });

  if (!message) {
    throw new Error("Mensaje no encontrado");
  }

  const updated = await prisma.chatMessage.update({
    where: { id: data.messageId },
    data: {
      isPinned: data.isPinned,
    },
    include: MESSAGE_INCLUDE,
  });

  await prisma.auditLog.create({
    data: {
      actorUserId: data.actorUserId,
      action: data.isPinned ? "CHAT_MESSAGE_PINNED" : "CHAT_MESSAGE_UNPINNED",
      entityType: "ChatMessage",
      entityId: updated.id,
      metadata: {
        isPinned: updated.isPinned,
      },
    },
  });

  return updated;
  });
}


// ---- Encuestas ----
async function loadPollForActor(tx: Parameters<Parameters<typeof serializable>[0]>[0], pollId: string, actorUserId: string) {
  await lockRow(tx, "ChatPoll", pollId);
  const poll = await tx.chatPoll.findUnique({ where: { id: pollId }, include: { options: { select: { id: true, text: true } }, message: { select: { id: true, authorUserId: true, audience: true, deletedAt: true } } } });
  if (!poll || poll.message.deletedAt) throw new OperationError(404, "Encuesta no encontrada");
  const audiences = await visibleAudiences(tx, actorUserId);
  if (poll.message.authorUserId !== actorUserId && !audiences.includes(poll.message.audience as ChatAudience)) throw new OperationError(403, "Esta encuesta es para otro grupo");
  return poll;
}

/** Reemplaza el voto de la persona (vacio = retirar el voto). Valido mientras la encuesta este abierta. */
export async function votePoll(actor: { userId: string }, pollId: string, optionIds: string[]) {
  return serializable(async (tx) => {
    const poll = await loadPollForActor(tx, pollId, actor.userId);
    if (poll.closedAt) throw new OperationError(409, "La encuesta está cerrada");
    const user = await tx.user.findUnique({ where: { id: actor.userId }, select: { profile: { select: { rank: true } } } });
    if ((user?.profile?.rank ?? "").toLowerCase() === "administrador") throw new OperationError(403, "El administrador del sistema no vota en encuestas");
    const unique = [...new Set(optionIds)];
    const valid = new Set(poll.options.map((o) => o.id));
    if (unique.some((id) => !valid.has(id))) throw new OperationError(400, "Opción inválida para esta encuesta");
    if (!poll.allowMultiple && unique.length > 1) throw new OperationError(400, "Esta encuesta admite una sola respuesta");
    const before = (await tx.chatPollVote.findMany({ where: { pollId, userId: actor.userId }, select: { optionId: true } })).map((v) => v.optionId);
    await tx.chatPollVote.deleteMany({ where: { pollId, userId: actor.userId } });
    if (unique.length) await tx.chatPollVote.createMany({ data: unique.map((optionId) => ({ pollId, optionId, userId: actor.userId })) });
    const text = (ids: string[]) => ids.map((id) => poll.options.find((o) => o.id === id)?.text ?? id);
    await tx.auditLog.create({ data: { actorUserId: actor.userId, action: unique.length ? "CHAT_POLL_VOTED" : "CHAT_POLL_VOTE_REMOVED", entityType: "ChatMessage", entityId: poll.message.id, metadata: { pollId, before: text(before), after: text(unique) } } });
    return tx.chatMessage.findUniqueOrThrow({ where: { id: poll.message.id }, include: MESSAGE_INCLUDE });
  });
}

/** Cierra la encuesta: la puede cerrar su autor o jefatura. Los votos quedan como estan. */
export async function closePoll(actor: { userId: string; role: string }, pollId: string) {
  return serializable(async (tx) => {
    const poll = await loadPollForActor(tx, pollId, actor.userId);
    if (poll.message.authorUserId !== actor.userId && !["ADMIN", "OPERATOR"].includes(actor.role)) throw new OperationError(403, "Solo quien creó la encuesta o jefatura puede cerrarla");
    if (!poll.closedAt) {
      await tx.chatPoll.update({ where: { id: pollId }, data: { closedAt: new Date(), closedByUserId: actor.userId } });
      const votes = await tx.chatPollVote.groupBy({ by: ["optionId"], where: { pollId }, _count: { _all: true } });
      await tx.auditLog.create({ data: { actorUserId: actor.userId, action: "CHAT_POLL_CLOSED", entityType: "ChatMessage", entityId: poll.message.id, metadata: { pollId, results: poll.options.map((o) => ({ option: o.text, votes: votes.find((v) => v.optionId === o.id)?._count._all ?? 0 })) } } });
    }
    return tx.chatMessage.findUniqueOrThrow({ where: { id: poll.message.id }, include: MESSAGE_INCLUDE });
  });
}


/** Foto adjunta: solo la ve quien puede ver el mensaje (mismo grupo destinatario). */
export async function chatAttachment(actorUserId: string, messageId: string, attachmentId: string) {
  const row = await prisma.chatAttachment.findFirst({ where: { id: attachmentId, messageId, message: { deletedAt: null } }, select: { bytes: true, message: { select: { authorUserId: true, audience: true } } } });
  if (!row) throw new OperationError(404, "Foto no encontrada");
  const audiences = await visibleAudiences(prisma, actorUserId);
  if (row.message.authorUserId !== actorUserId && !audiences.includes(row.message.audience as ChatAudience)) throw new OperationError(403, "Esta foto es de un mensaje para otro grupo");
  return row.bytes;
}
