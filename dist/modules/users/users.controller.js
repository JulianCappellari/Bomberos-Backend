"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAllUsersController = getAllUsersController;
exports.getActiveUserRosterController = getActiveUserRosterController;
exports.getUserByIdController = getUserByIdController;
exports.createUserController = createUserController;
exports.updateUserController = updateUserController;
exports.toggleUserActiveController = toggleUserActiveController;
const users_service_1 = require("./users.service");
const users_schemas_1 = require("./users.schemas");
async function getAllUsersController(req, res) {
    try {
        const users = await (0, users_service_1.getAllUsers)();
        return res.status(200).json(users);
    }
    catch (error) {
        return res.status(500).json({
            message: error.message || "Failed to fetch users",
        });
    }
}
async function getActiveUserRosterController(_req, res) {
    try {
        const users = await (0, users_service_1.getActiveUserRoster)();
        return res.status(200).json(users);
    }
    catch (error) {
        return res.status(500).json({
            message: error.message || "Failed to fetch user roster",
        });
    }
}
async function getUserByIdController(req, res) {
    try {
        const userId = String(req.params.id);
        const user = await (0, users_service_1.getUserById)(userId);
        return res.status(200).json(user);
    }
    catch (error) {
        return res.status(404).json({
            message: error.message || "User not found",
        });
    }
}
async function createUserController(req, res) {
    try {
        const parsed = users_schemas_1.createUserSchema.parse(req.body);
        const user = await (0, users_service_1.createUser)(parsed, req.user?.userId);
        return res.status(201).json(user);
    }
    catch (error) {
        return res.status(400).json({
            message: error.message || "Failed to create user",
        });
    }
}
async function updateUserController(req, res) {
    try {
        const userId = String(req.params.id);
        const parsed = users_schemas_1.updateUserSchema.parse(req.body);
        const user = await (0, users_service_1.updateUser)(userId, parsed, req.user?.userId);
        return res.status(200).json(user);
    }
    catch (error) {
        return res.status(error.status || 400).json({
            message: error.message || "Failed to update user",
        });
    }
}
async function toggleUserActiveController(req, res) {
    try {
        const userId = String(req.params.id);
        const user = await (0, users_service_1.toggleUserActive)(userId, req.user?.userId);
        return res.status(200).json(user);
    }
    catch (error) {
        return res.status(400).json({
            message: error.message || "Failed to toggle user status",
        });
    }
}
