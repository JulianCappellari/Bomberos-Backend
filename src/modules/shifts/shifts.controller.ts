import { Request, Response } from "express";
import {
  assignUsersToShiftSchema,
  createShiftSchema,
  listShiftsQuerySchema,
  updateShiftSchema,
} from "./shifts.schemas";
import {
  assignUsersToShift,
  createShift,
  deleteShift,
  getAllShifts,
  getShiftById,
  updateShift,
} from "./shifts.service";

export async function createShiftController(req: Request, res: Response) {
  try {
    const actorUserId = req.user?.userId;

    if (!actorUserId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const parsed = createShiftSchema.parse(req.body);

    const shift = await createShift({
      ...parsed,
      notes: parsed.notes || null,
      createdByUserId: actorUserId,
    });

    return res.status(201).json(shift);
  } catch (error: any) {
    return res.status(error.status || 400).json({
      message: error.message || "Failed to create shift",
    });
  }
}

export async function updateShiftController(req: Request, res: Response) {
  try {
    const actorUserId = req.user?.userId;
    if (!actorUserId) return res.status(401).json({ message: "Unauthorized" });
    const parsed = updateShiftSchema.parse(req.body);
    const shift = await updateShift(
      String(req.params.id),
      { ...parsed, notes: parsed.notes || null },
      actorUserId,
    );
    return res.status(200).json(shift);
  } catch (error: any) {
    return res.status(error.status || 400).json({ message: error.message || "No se pudo actualizar la guardia" });
  }
}

export async function getAllShiftsController(req: Request, res: Response) {
  try {
    const parsed = listShiftsQuerySchema.parse(req.query);

    const shifts = await getAllShifts(parsed);

    return res.status(200).json(shifts);
  } catch (error: any) {
    return res.status(error.status || 400).json({
      message: error.message || "Failed to fetch shifts",
    });
  }
}

export async function getShiftByIdController(req: Request, res: Response) {
  try {
    const shiftId = String(req.params.id);
    const shift = await getShiftById(shiftId);

    return res.status(200).json(shift);
  } catch (error: any) {
    return res.status(404).json({
      message: error.message || "Shift not found",
    });
  }
}

export async function assignUsersToShiftController(req: Request, res: Response) {
  try {
    const shiftId = String(req.params.id);
    const parsed = assignUsersToShiftSchema.parse(req.body);

    const shift = await assignUsersToShift(
      shiftId,
      parsed.userIds,
      req.user?.userId,
    );

    return res.status(200).json(shift);
  } catch (error: any) {
    return res.status(error.status || 400).json({
      message: error.message || "Failed to assign users to shift",
    });
  }
}

export async function deleteShiftController(req: Request, res: Response) {
  try {
    const shiftId = String(req.params.id);

    const result = await deleteShift(shiftId, req.user?.userId);

    return res.status(200).json(result);
  } catch (error: any) {
    return res.status(error.status || 400).json({
      message: error.message || "Failed to delete shift",
    });
  }
}
