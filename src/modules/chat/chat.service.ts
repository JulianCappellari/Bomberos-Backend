import { prisma } from "../../config/prisma";
import { isCommandRank, effectiveAccessRole } from "../../utils/firefighter-ranks";
import { OperationError } from "../operations/operations.schemas";
import { serializable } from "../../utils/transaction";

const MESSAGE_INCLUDE = {
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
}) {
  return prisma.chatMessage.findMany({
    where: {
      deletedAt: null,
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
}) {
  return serializable(async (prisma) => {
  const message = await prisma.chatMessage.create({
    data: {
      body: data.body,
      authorUserId: data.authorUserId,
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
      },
    },
  });

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
  await prisma.$queryRaw`SELECT "id" FROM "ChatMessage" WHERE "id" = ${data.messageId} FOR UPDATE`;
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
    },
  });

  if (!message) {
    throw new Error("Chat message not found");
  }

  // N02: nadie edita mensajes ajenos; solo su autor.
  if (message.authorUserId !== data.actorUserId) throw new OperationError(403, "Solo el autor puede editar su mensaje");

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
    const people = await prisma.user.findMany({ where: { isActive: true, isPendingApproval: false, deletedAt: null, id: { not: data.actorUserId } }, select: { id: true } });
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
  await prisma.$queryRaw`SELECT "id" FROM "ChatMessage" WHERE "id" = ${data.messageId} FOR UPDATE`;

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
    throw new Error("Chat message not found");
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

  return { message: "Chat message deleted successfully" };
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
  await prisma.$queryRaw`SELECT "id" FROM "ChatMessage" WHERE "id" = ${data.messageId} FOR UPDATE`;

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
    throw new Error("Chat message not found");
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
