"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createShiftController = createShiftController;
exports.updateShiftController = updateShiftController;
exports.getAllShiftsController = getAllShiftsController;
exports.getShiftByIdController = getShiftByIdController;
exports.assignUsersToShiftController = assignUsersToShiftController;
exports.deleteShiftController = deleteShiftController;
const shifts_schemas_1 = require("./shifts.schemas");
const shifts_service_1 = require("./shifts.service");
async function createShiftController(req, res) {
    try {
        const actorUserId = req.user?.userId;
        if (!actorUserId) {
            return res.status(401).json({ message: "Unauthorized" });
        }
        const parsed = shifts_schemas_1.createShiftSchema.parse(req.body);
        const shift = await (0, shifts_service_1.createShift)({
            ...parsed,
            notes: parsed.notes || null,
            createdByUserId: actorUserId,
        });
        return res.status(201).json(shift);
    }
    catch (error) {
        return res.status(error.status || 400).json({
            message: error.message || "Failed to create shift",
        });
    }
}
async function updateShiftController(req, res) {
    try {
        const actorUserId = req.user?.userId;
        if (!actorUserId)
            return res.status(401).json({ message: "Unauthorized" });
        const parsed = shifts_schemas_1.updateShiftSchema.parse(req.body);
        const shift = await (0, shifts_service_1.updateShift)(String(req.params.id), { ...parsed, notes: parsed.notes || null }, actorUserId);
        return res.status(200).json(shift);
    }
    catch (error) {
        return res.status(error.status || 400).json({ message: error.message || "No se pudo actualizar la guardia" });
    }
}
async function getAllShiftsController(req, res) {
    try {
        const parsed = shifts_schemas_1.listShiftsQuerySchema.parse(req.query);
        const shifts = await (0, shifts_service_1.getAllShifts)(parsed);
        return res.status(200).json(shifts);
    }
    catch (error) {
        return res.status(error.status || 400).json({
            message: error.message || "Failed to fetch shifts",
        });
    }
}
async function getShiftByIdController(req, res) {
    try {
        const shiftId = String(req.params.id);
        const shift = await (0, shifts_service_1.getShiftById)(shiftId);
        return res.status(200).json(shift);
    }
    catch (error) {
        return res.status(404).json({
            message: error.message || "Shift not found",
        });
    }
}
async function assignUsersToShiftController(req, res) {
    try {
        const shiftId = String(req.params.id);
        const parsed = shifts_schemas_1.assignUsersToShiftSchema.parse(req.body);
        const shift = await (0, shifts_service_1.assignUsersToShift)(shiftId, parsed.userIds, req.user?.userId);
        return res.status(200).json(shift);
    }
    catch (error) {
        return res.status(error.status || 400).json({
            message: error.message || "Failed to assign users to shift",
        });
    }
}
async function deleteShiftController(req, res) {
    try {
        const shiftId = String(req.params.id);
        const result = await (0, shifts_service_1.deleteShift)(shiftId, req.user?.userId);
        return res.status(200).json(result);
    }
    catch (error) {
        return res.status(error.status || 400).json({
            message: error.message || "Failed to delete shift",
        });
    }
}
