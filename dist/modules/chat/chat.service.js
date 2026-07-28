"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listChatMessages = listChatMessages;
exports.createChatMessage = createChatMessage;
exports.updateChatMessage = updateChatMessage;
exports.deleteChatMessage = deleteChatMessage;
exports.setChatMessagePinned = setChatMessagePinned;
const prisma_1 = require("../../config/prisma");
const firefighter_ranks_1 = require("../../utils/firefighter-ranks");
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
async function getActorRank(actorUserId) {
    const actor = await prisma_1.prisma.user.findFirst({
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
async function assertCommandRank(actorUserId) {
    const actorRank = await getActorRank(actorUserId);
    if (!(0, firefighter_ranks_1.isCommandRank)(actorRank)) {
        throw new Error("Only oficiales and sub oficiales can moderate chat messages");
    }
}
async function listChatMessages(data) {
    return prisma_1.prisma.chatMessage.findMany({
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
async function createChatMessage(data) {
    const message = await prisma_1.prisma.chatMessage.create({
        data: {
            body: data.body,
            authorUserId: data.authorUserId,
        },
        include: MESSAGE_INCLUDE,
    });
    await prisma_1.prisma.auditLog.create({
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
async function updateChatMessage(data) {
    const message = await prisma_1.prisma.chatMessage.findFirst({
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
    const updated = await prisma_1.prisma.chatMessage.update({
        where: { id: data.messageId },
        data: {
            body: data.body,
            editedAt: new Date(),
        },
        include: MESSAGE_INCLUDE,
    });
    await prisma_1.prisma.auditLog.create({
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
async function deleteChatMessage(data) {
    await assertCommandRank(data.actorUserId);
    const message = await prisma_1.prisma.chatMessage.findFirst({
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
    const deleted = await prisma_1.prisma.chatMessage.update({
        where: { id: data.messageId },
        data: {
            deletedAt: new Date(),
            isPinned: false,
        },
        include: MESSAGE_INCLUDE,
    });
    await prisma_1.prisma.auditLog.create({
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
async function setChatMessagePinned(data) {
    await assertCommandRank(data.actorUserId);
    const message = await prisma_1.prisma.chatMessage.findFirst({
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
    const updated = await prisma_1.prisma.chatMessage.update({
        where: { id: data.messageId },
        data: {
            isPinned: data.isPinned,
        },
        include: MESSAGE_INCLUDE,
    });
    await prisma_1.prisma.auditLog.create({
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
