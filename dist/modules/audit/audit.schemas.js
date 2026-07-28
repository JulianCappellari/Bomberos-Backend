"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listAuditLogsQuerySchema = void 0;
const zod_1 = require("zod");
exports.listAuditLogsQuerySchema = zod_1.z.object({
    limit: zod_1.z.coerce.number().int().min(1).max(100).default(50),
    entityType: zod_1.z.string().trim().min(1).max(80).optional(),
    action: zod_1.z.string().trim().min(1).max(120).optional(),
});
