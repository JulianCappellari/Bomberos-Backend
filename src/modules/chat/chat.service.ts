import { prisma } from "../../config/prisma";
import { isCommandRank } from "../../utils/firefighter-ranks";

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
      profile: {
        select: {
          rank: true,
        },
      },
    },
  });

  return actor?.profile?.rank ?? null;
}

async function assertCommandRank(actorUserId: string) {
  const actorRank = await getActorRank(actorUserId);

  if (!isCommandRank(actorRank)) {
    throw new Error("Only oficiales and sub oficiales can moderate chat messages");
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
}

export async function updateChatMessage(data: {
  messageId: string;
  actorUserId: string;
  body: string;
}) {
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

  if (message.authorUserId !== data.actorUserId) {
    throw new Error("You are not allowed to update this message");
  }

  const updated = await prisma.chatMessage.update({
    where: { id: data.messageId },
    data: {
      body: data.body,
      editedAt: new Date(),
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
      },
    },
  });

  return updated;
}

export async function deleteChatMessage(data: {
  messageId: string;
  actorUserId: string;
}) {
  await assertCommandRank(data.actorUserId);

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
}

export async function setChatMessagePinned(data: {
  messageId: string;
  actorUserId: string;
  isPinned: boolean;
}) {
  await assertCommandRank(data.actorUserId);

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
}
