import { Request, Response } from "express";
import {
  complianceRecordInputSchema,
  listComplianceRecordsSchema,
} from "./compliance.schemas";
import {
  createComplianceRecord,
  deleteComplianceRecord,
  getComplianceSummary,
  listComplianceRecords,
  updateComplianceRecord,
} from "./compliance.service";

export async function listComplianceRecordsController(req: Request, res: Response) {
  const filters = listComplianceRecordsSchema.parse(req.query);
  return res.status(200).json(await listComplianceRecords(filters));
}

export async function getComplianceSummaryController(_req: Request, res: Response) {
  return res.status(200).json(await getComplianceSummary());
}

export async function createComplianceRecordController(req: Request, res: Response) {
  const actorUserId = req.user?.userId;
  if (!actorUserId) return res.status(401).json({ message: "Sesión no válida. Volvé a ingresar." });
  const input = complianceRecordInputSchema.parse(req.body);
  return res.status(201).json(await createComplianceRecord(input, actorUserId));
}

export async function updateComplianceRecordController(req: Request, res: Response) {
  const actorUserId = req.user?.userId;
  if (!actorUserId) return res.status(401).json({ message: "Sesión no válida. Volvé a ingresar." });
  const input = complianceRecordInputSchema.parse(req.body);
  return res
    .status(200)
    .json(await updateComplianceRecord(String(req.params.id), input, actorUserId));
}

export async function deleteComplianceRecordController(req: Request, res: Response) {
  const actorUserId = req.user?.userId;
  if (!actorUserId) return res.status(401).json({ message: "Sesión no válida. Volvé a ingresar." });
  return res
    .status(200)
    .json(await deleteComplianceRecord(String(req.params.id), actorUserId));
}
