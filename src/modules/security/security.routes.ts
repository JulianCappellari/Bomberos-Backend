import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../middlewares/auth.middleware";
import { authorize } from "../../middlewares/role.middleware";
import { revokeAllSessions, securityOverview, unlockAccount } from "./security.service";

// Centro de seguridad: solo administracion.
const router = Router();
router.use(authenticate, authorize("ADMIN"));
router.get("/overview", async (req, res) => { res.json(await securityOverview(req.user!)); });
router.post("/users/:id/unlock", async (req, res) => { res.json(await unlockAccount(req.user!, String(req.params.id))); });
router.post("/users/:id/revoke-sessions", async (req, res) => { res.json(await revokeAllSessions(req.user!, String(req.params.id), z.object({ reason: z.string().trim().min(10).max(500) }).strict().parse(req.body).reason)); });
export default router;
