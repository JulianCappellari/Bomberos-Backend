import { Router } from "express";
import { authenticate } from "../../middlewares/auth.middleware";
import { chatAttachment, closePoll, votePoll } from "./chat.service";
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
// Fotos adjuntas: privadas, se sirven con la sesion y no se guardan en caches compartidas.
router.get("/messages/:id/photos/:photoId", async (req, res) => { const bytes = await chatAttachment(req.user!.userId, String(req.params.id), String(req.params.photoId)); res.set("Cache-Control", "private, max-age=3600").type("image/jpeg").send(Buffer.from(bytes)); });
// Encuestas
router.post("/polls/:id/vote", async (req, res) => { res.json(await votePoll(req.user!, String(req.params.id), votePollSchema.parse(req.body).optionIds)); });
router.post("/polls/:id/close", async (req, res) => { res.json(await closePoll(req.user!, String(req.params.id))); });

export default router;
