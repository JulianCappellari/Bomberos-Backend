"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createAttendanceQrChallengeController = createAttendanceQrChallengeController;
exports.scanAttendanceQrController = scanAttendanceQrController;
exports.getMyOpenAttendanceController = getMyOpenAttendanceController;
exports.getPresentPersonnelController = getPresentPersonnelController;
exports.getMyAttendancesController = getMyAttendancesController;
exports.getMyAttendanceSummaryController = getMyAttendanceSummaryController;
const attendance_schemas_1 = require("./attendance.schemas");
const attendance_service_1 = require("./attendance.service");
async function createAttendanceQrChallengeController(req, res) {
    try {
        const parsed = attendance_schemas_1.createQrChallengeSchema.parse(req.body);
        const userId = req.user?.userId;
        const result = await (0, attendance_service_1.createAttendanceQrChallenge)(parsed.stationId, userId);
        return res.status(201).json(result);
    }
    catch (error) {
        return res.status(400).json({
            message: error.message || "No se pudo generar el QR",
        });
    }
}
async function scanAttendanceQrController(req, res) {
    try {
        const userId = req.user?.userId;
        if (!userId) {
            return res.status(401).json({ message: "Sesión no válida. Volvé a ingresar." });
        }
        const parsed = attendance_schemas_1.scanAttendanceQrSchema.parse(req.body);
        const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
            req.socket.remoteAddress ||
            "";
        const result = await (0, attendance_service_1.scanAttendanceQr)({
            userId,
            actorRole: req.user.role,
            qrToken: parsed.qrToken,
            latitude: parsed.latitude,
            longitude: parsed.longitude,
            accuracy: parsed.accuracy,
            deviceFingerprint: parsed.deviceFingerprint,
            ip,
        });
        return res.status(200).json(result);
    }
    catch (error) {
        return res.status(error.status || 400).json({
            message: error.message || "No se pudo registrar la asistencia",
        });
    }
}
async function getMyOpenAttendanceController(req, res) {
    try {
        const userId = req.user?.userId;
        if (!userId) {
            return res.status(401).json({ message: "Sesión no válida. Volvé a ingresar." });
        }
        const attendance = await (0, attendance_service_1.getMyOpenAttendance)(userId);
        return res.status(200).json(attendance);
    }
    catch (error) {
        return res.status(500).json({
            message: error.message || "No se pudo obtener la asistencia activa",
        });
    }
}
async function getPresentPersonnelController(_req, res) {
    try {
        const present = await (0, attendance_service_1.getPresentPersonnel)();
        return res.status(200).json(present);
    }
    catch (error) {
        return res.status(500).json({
            message: error.message || "No se pudo obtener el personal presente",
        });
    }
}
async function getMyAttendancesController(req, res) {
    try {
        const userId = req.user?.userId;
        if (!userId) {
            return res.status(401).json({ message: "Sesión no válida. Volvé a ingresar." });
        }
        const attendances = await (0, attendance_service_1.getMyAttendances)(userId);
        return res.status(200).json(attendances);
    }
    catch (error) {
        return res.status(500).json({
            message: error.message || "No se pudo obtener el historial",
        });
    }
}
async function getMyAttendanceSummaryController(req, res) {
    try {
        const userId = req.user?.userId;
        if (!userId) {
            return res.status(401).json({ message: "Sesión no válida. Volvé a ingresar." });
        }
        const summary = await (0, attendance_service_1.getMyAttendanceSummary)(userId);
        return res.status(200).json(summary);
    }
    catch (error) {
        return res.status(500).json({
            message: error.message || "No se pudo obtener el resumen de asistencias",
        });
    }
}
