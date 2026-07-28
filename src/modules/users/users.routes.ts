import { Router } from "express";
import {
  createUserController,
  getActiveUserRosterController,
  getAllUsersController,
  getUserByIdController,
  toggleUserActiveController,
  updateUserController,
} from "./users.controller";
import { authenticate } from "../../middlewares/auth.middleware";
import { authorize } from "../../middlewares/role.middleware";

const router = Router();

router.use(authenticate);

router.get("/roster", getActiveUserRosterController);
router.get("/", authorize("ADMIN"), getAllUsersController);
router.get("/:id", authorize("ADMIN"), getUserByIdController);
router.post("/", authorize("ADMIN"), createUserController);
router.patch("/:id", authorize("ADMIN"), updateUserController);
router.patch("/:id/toggle-active", authorize("ADMIN"), toggleUserActiveController);

export default router;
