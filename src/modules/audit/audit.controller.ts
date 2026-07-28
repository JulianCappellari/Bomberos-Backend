import { Request, Response } from "express";
import { listAuditLogsQuerySchema } from "./audit.schemas";
import { listAuditLogs } from "./audit.service";

export async function listAuditLogsController(req: Request, res: Response) {
  try {
    const parsed = listAuditLogsQuerySchema.parse(req.query);
    const logs = await listAuditLogs(parsed);

    return res.status(200).json(logs);
  } catch (error: any) {
    return res.status(400).json({
      message: error.message || "Failed to fetch audit logs",
    });
  }
}
