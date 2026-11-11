import { Router } from "express";
import { authenticate } from "../../middlewares/auth.middleware";
import { closePoll, votePoll } from "./chat.service";
import { votePollSchema } from "./chat.schemas";
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
// Encuestas
router.post("/polls/:id/vote", async (req, res) => { res.json(await votePoll(req.user!, String(req.params.id), votePollSchema.parse(req.body).optionIds)); });
router.post("/polls/:id/close", async (req, res) => { res.json(await closePoll(req.user!, String(req.params.id))); });

export default router;
