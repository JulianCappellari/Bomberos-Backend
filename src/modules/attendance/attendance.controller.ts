import { Request, Response } from "express";
import {
  createQrChallengeSchema,
  scanAttendanceQrSchema,
} from "./attendance.schemas";
import {
  createAttendanceQrChallenge,
  getMyAttendances,
  getMyAttendanceSummary,
  getMyOpenAttendance,
  getPresentPersonnel,
  scanAttendanceQr,
} from "./attendance.service";


export async function createAttendanceQrChallengeController(
  req: Request,
  res: Response,
) {
  try {
    const parsed = createQrChallengeSchema.parse(req.body);
    const userId = req.user?.userId;

    const result = await createAttendanceQrChallenge(parsed.stationId, userId);

    return res.status(201).json(result);
  } catch (error: any) {
    return res.status(400).json({
      message: error.message || "No se pudo generar el QR",
    });
  }
}

export async function scanAttendanceQrController(req: Request, res: Response) {
  try {
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const parsed = scanAttendanceQrSchema.parse(req.body);

    const ip =
      (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
      req.socket.remoteAddress ||
      "";

    const result = await scanAttendanceQr({
      userId,
      actorRole: req.user!.role,
      qrToken: parsed.qrToken,
      latitude: parsed.latitude,
      longitude: parsed.longitude,
      accuracy: parsed.accuracy,
      deviceFingerprint: parsed.deviceFingerprint,
      ip,
    });

    return res.status(200).json(result);
  } catch (error: any) {
    return res.status(error.status || 400).json({
      message: error.message || "No se pudo registrar la asistencia",
    });
  }
}

export async function getMyOpenAttendanceController(req: Request, res: Response) {
  try {
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const attendance = await getMyOpenAttendance(userId);
    return res.status(200).json(attendance);
  } catch (error: any) {
    return res.status(500).json({
      message: error.message || "No se pudo obtener la asistencia activa",
    });
  }
}

export async function getPresentPersonnelController(
  _req: Request,
  res: Response,
) {
  try {
    const present = await getPresentPersonnel();
    return res.status(200).json(present);
  } catch (error: any) {
    return res.status(500).json({
      message: error.message || "No se pudo obtener el personal presente",
    });
  }
}

export async function getMyAttendancesController(req: Request, res: Response) {
  try {
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const attendances = await getMyAttendances(userId);
    return res.status(200).json(attendances);
  } catch (error: any) {
    return res.status(500).json({
      message: error.message || "No se pudo obtener el historial",
    });
  }
}


export async function getMyAttendanceSummaryController(
  req: Request,
  res: Response,
) {
  try {
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const summary = await getMyAttendanceSummary(userId);

    return res.status(200).json(summary);
  } catch (error: any) {
    return res.status(500).json({
      message: error.message || "No se pudo obtener el resumen de asistencias",
    });
  }
}
