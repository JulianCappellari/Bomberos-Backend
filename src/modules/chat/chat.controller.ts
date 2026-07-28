import { Request, Response } from "express";
import {
  createChatMessageSchema,
  listChatMessagesQuerySchema,
  pinChatMessageSchema,
  updateChatMessageSchema,
} from "./chat.schemas";
import {
  createChatMessage,
  deleteChatMessage,
  listChatMessages,
  setChatMessagePinned,
  updateChatMessage,
} from "./chat.service";

function resolveStatus(error: unknown) {
  const message = error instanceof Error ? error.message : "";

  if (message.includes("not found")) return 404;
  if (
    message.includes("not allowed") ||
    message.includes("Only oficiales and sub oficiales")
  ) {
    return 403;
  }

  return 400;
}

export async function listChatMessagesController(req: Request, res: Response) {
  try {
    const parsed = listChatMessagesQuerySchema.parse(req.query);
    const messages = await listChatMessages(parsed);

    return res.status(200).json(messages);
  } catch (error: any) {
    return res.status(400).json({
      message: error.message || "Failed to fetch chat messages",
    });
  }
}

export async function createChatMessageController(req: Request, res: Response) {
  try {
    const actorUserId = req.user?.userId;

    if (!actorUserId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const parsed = createChatMessageSchema.parse(req.body);
    const message = await createChatMessage({
      body: parsed.body,
      authorUserId: actorUserId,
    });

    return res.status(201).json(message);
  } catch (error: any) {
    return res.status(400).json({
      message: error.message || "Failed to create chat message",
    });
  }
}

export async function updateChatMessageController(req: Request, res: Response) {
  try {
    const actorUserId = req.user?.userId;

    if (!actorUserId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const parsed = updateChatMessageSchema.parse(req.body);
    const message = await updateChatMessage({
      messageId: String(req.params.id),
      actorUserId,
      body: parsed.body,
    });

    return res.status(200).json(message);
  } catch (error: any) {
    return res.status(resolveStatus(error)).json({
      message: error.message || "Failed to update chat message",
    });
  }
}

export async function deleteChatMessageController(req: Request, res: Response) {
  try {
    const actorUserId = req.user?.userId;

    if (!actorUserId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const result = await deleteChatMessage({
      messageId: String(req.params.id),
      actorUserId,
    });

    return res.status(200).json(result);
  } catch (error: any) {
    return res.status(resolveStatus(error)).json({
      message: error.message || "Failed to delete chat message",
    });
  }
}

export async function pinChatMessageController(req: Request, res: Response) {
  try {
    const actorUserId = req.user?.userId;

    if (!actorUserId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const parsed = pinChatMessageSchema.parse(req.body);
    const message = await setChatMessagePinned({
      messageId: String(req.params.id),
      actorUserId,
      isPinned: parsed.isPinned,
    });

    return res.status(200).json(message);
  } catch (error: any) {
    return res.status(resolveStatus(error)).json({
      message: error.message || "Failed to pin chat message",
    });
  }
}
