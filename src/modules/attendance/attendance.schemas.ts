import { z } from "zod";

export const createQrChallengeSchema = z.object({
  stationId: z.string().min(1),
});

export const scanAttendanceQrSchema = z.object({
  qrToken: z.string().min(1, "QR token requerido"),
  // Opcionales: la base sin ubicacion no las pide; las demas responden 428 si faltan.
  latitude: z.number().finite().min(-90).max(90).optional(),
  longitude: z.number().finite().min(-180).max(180).optional(),
  accuracy: z.number().optional(),
  deviceFingerprint: z.string().min(1, "Device fingerprint requerido"),
});