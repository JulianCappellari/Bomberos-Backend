"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pinChatMessageSchema = exports.updateChatMessageSchema = exports.createChatMessageSchema = exports.listChatMessagesQuerySchema = void 0;
const zod_1 = require("zod");
exports.listChatMessagesQuerySchema = zod_1.z.object({
    limit: zod_1.z.coerce.number().int().min(1).max(100).default(50),
    before: zod_1.z.string().datetime().optional(),
});
exports.createChatMessageSchema = zod_1.z.object({
    body: zod_1.z.string().trim().min(1).max(1000),
    audience: zod_1.z.enum(["ALL", "COMMAND", "DRIVERS", "GUARD", "BOARD"]).default("ALL"),
});
exports.updateChatMessageSchema = zod_1.z.object({
    body: zod_1.z.string().trim().min(1).max(1000),
});
exports.pinChatMessageSchema = zod_1.z.object({
    isPinned: zod_1.z.boolean(),
});
