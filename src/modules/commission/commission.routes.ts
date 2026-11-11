import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../middlewares/auth.middleware";
import { commissionAccess, commissionOverview } from "./commission.service";

const router = Router();
router.use(authenticate);
router.get("/access", async (req, res) => { res.json({ allowed: await commissionAccess(req.user!) }); });
router.get("/overview", async (req, res) => { res.json(await commissionOverview(req.user!, z.coerce.number().int().min(1).max(24).default(12).parse(req.query.months))); });
export default router;
