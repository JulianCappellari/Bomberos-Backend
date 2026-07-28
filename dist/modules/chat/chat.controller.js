"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listChatMessagesController = listChatMessagesController;
exports.createChatMessageController = createChatMessageController;
exports.updateChatMessageController = updateChatMessageController;
exports.deleteChatMessageController = deleteChatMessageController;
exports.pinChatMessageController = pinChatMessageController;
const chat_schemas_1 = require("./chat.schemas");
const chat_service_1 = require("./chat.service");
function resolveStatus(error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("not found"))
        return 404;
    if (message.includes("not allowed") ||
        message.includes("Only oficiales and sub oficiales")) {
        return 403;
    }
    return 400;
}
async function listChatMessagesController(req, res) {
    try {
        const parsed = chat_schemas_1.listChatMessagesQuerySchema.parse(req.query);
        const messages = await (0, chat_service_1.listChatMessages)(parsed);
        return res.status(200).json(messages);
    }
    catch (error) {
        return res.status(400).json({
            message: error.message || "Failed to fetch chat messages",
        });
    }
}
async function createChatMessageController(req, res) {
    try {
        const actorUserId = req.user?.userId;
        if (!actorUserId) {
            return res.status(401).json({ message: "Unauthorized" });
        }
        const parsed = chat_schemas_1.createChatMessageSchema.parse(req.body);
        const message = await (0, chat_service_1.createChatMessage)({
            body: parsed.body,
            authorUserId: actorUserId,
        });
        return res.status(201).json(message);
    }
    catch (error) {
        return res.status(400).json({
            message: error.message || "Failed to create chat message",
        });
    }
}
async function updateChatMessageController(req, res) {
    try {
        const actorUserId = req.user?.userId;
        if (!actorUserId) {
            return res.status(401).json({ message: "Unauthorized" });
        }
        const parsed = chat_schemas_1.updateChatMessageSchema.parse(req.body);
        const message = await (0, chat_service_1.updateChatMessage)({
            messageId: String(req.params.id),
            actorUserId,
            body: parsed.body,
        });
        return res.status(200).json(message);
    }
    catch (error) {
        return res.status(resolveStatus(error)).json({
            message: error.message || "Failed to update chat message",
        });
    }
}
async function deleteChatMessageController(req, res) {
    try {
        const actorUserId = req.user?.userId;
        if (!actorUserId) {
            return res.status(401).json({ message: "Unauthorized" });
        }
        const result = await (0, chat_service_1.deleteChatMessage)({
            messageId: String(req.params.id),
            actorUserId,
        });
        return res.status(200).json(result);
    }
    catch (error) {
        return res.status(resolveStatus(error)).json({
            message: error.message || "Failed to delete chat message",
        });
    }
}
async function pinChatMessageController(req, res) {
    try {
        const actorUserId = req.user?.userId;
        if (!actorUserId) {
            return res.status(401).json({ message: "Unauthorized" });
        }
        const parsed = chat_schemas_1.pinChatMessageSchema.parse(req.body);
        const message = await (0, chat_service_1.setChatMessagePinned)({
            messageId: String(req.params.id),
            actorUserId,
            isPinned: parsed.isPinned,
        });
        return res.status(200).json(message);
    }
    catch (error) {
        return res.status(resolveStatus(error)).json({
            message: error.message || "Failed to pin chat message",
        });
    }
}
