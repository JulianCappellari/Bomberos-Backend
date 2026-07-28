import { Request, Response } from "express";
import {
  createUser,
  getActiveUserRoster,
  getAllUsers,
  getUserById,
  toggleUserActive,
  updateUser,
} from "./users.service";
import { createUserSchema, updateUserSchema } from "./users.schemas";

export async function getAllUsersController(req: Request, res: Response) {
  try {
    const users = await getAllUsers();
    return res.status(200).json(users);
  } catch (error: any) {
    return res.status(500).json({
      message: error.message || "Failed to fetch users",
    });
  }
}

export async function getActiveUserRosterController(
  _req: Request,
  res: Response,
) {
  try {
    const users = await getActiveUserRoster();
    return res.status(200).json(users);
  } catch (error: any) {
    return res.status(500).json({
      message: error.message || "Failed to fetch user roster",
    });
  }
}

export async function getUserByIdController(req: Request, res: Response) {
  try {
    const userId = String(req.params.id);
    const user = await getUserById(userId);

    return res.status(200).json(user);
  } catch (error: any) {
    return res.status(404).json({
      message: error.message || "User not found",
    });
  }
}

export async function createUserController(req: Request, res: Response) {
  try {
    const parsed = createUserSchema.parse(req.body);
    const user = await createUser(parsed, req.user?.userId);

    return res.status(201).json(user);
  } catch (error: any) {
    return res.status(400).json({
      message: error.message || "Failed to create user",
    });
  }
}

export async function updateUserController(req: Request, res: Response) {
  try {
    const userId = String(req.params.id);
    const parsed = updateUserSchema.parse(req.body);
    const user = await updateUser(userId, parsed, req.user?.userId);

    return res.status(200).json(user);
  } catch (error: any) {
    return res.status(400).json({
      message: error.message || "Failed to update user",
    });
  }
}

export async function toggleUserActiveController(req: Request, res: Response) {
  try {
    const userId = String(req.params.id);
    const user = await toggleUserActive(userId, req.user?.userId);

    return res.status(200).json(user);
  } catch (error: any) {
    return res.status(400).json({
      message: error.message || "Failed to toggle user status",
    });
  }
}
