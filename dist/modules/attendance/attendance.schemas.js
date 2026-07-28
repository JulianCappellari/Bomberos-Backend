"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.scanAttendanceQrSchema = exports.createQrChallengeSchema = void 0;
const zod_1 = require("zod");
exports.createQrChallengeSchema = zod_1.z.object({
    stationId: zod_1.z.string().min(1),
});
exports.scanAttendanceQrSchema = zod_1.z.object({
    qrToken: zod_1.z.string().min(1, "QR token requerido"),
    latitude: zod_1.z.number(),
    longitude: zod_1.z.number(),
    accuracy: zod_1.z.number().optional(),
    deviceFingerprint: zod_1.z.string().min(1, "Device fingerprint requerido"),
});
