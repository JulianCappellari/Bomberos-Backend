import { z } from "zod";

export const createQrChallengeSchema = z.object({
  stationId: z.string().min(1),
});

export const scanAttendanceQrSchema = z.object({
  qrToken: z.string().min(1, "QR token requerido"),
  latitude: z.number(),
  longitude: z.number(),
  accuracy: z.number().optional(),
  deviceFingerprint: z.string().min(1, "Device fingerprint requerido"),
});