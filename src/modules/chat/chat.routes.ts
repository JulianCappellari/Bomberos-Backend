import { Router } from "express";
import { authenticate } from "../../middlewares/auth.middleware";
import {
  createChatMessageController,
  deleteChatMessageController,
  listChatMessagesController,
  pinChatMessageController,
  updateChatMessageController,
} from "./chat.controller";

const router = Router();

router.use(authenticate);

router.get("/messages", listChatMessagesController);
router.post("/messages", createChatMessageController);
router.patch("/messages/:id", updateChatMessageController);
router.patch("/messages/:id/pin", pinChatMessageController);
router.delete("/messages/:id", deleteChatMessageController);

export default router;
