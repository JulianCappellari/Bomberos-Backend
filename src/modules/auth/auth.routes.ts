import { Router } from "express";
import { z } from "zod";
import {guardFunctionAllowed} from "../../utils/firefighter-ranks";
import { serializable } from "../../utils/transaction";
import { OperationError } from "../operations/operations.schemas";
import {
  changePasswordController,
  loginController,
  refreshTokenController,
} from "./auth.controller";
import { authenticate } from "../../middlewares/auth.middleware";
import { rateLimit } from "../../middlewares/rate-limit.middleware";
import { listSessions, revokeSession, revokeOtherSessions, mapSafeUser } from "./auth.service";
import { prisma } from "../../config/prisma";

const router = Router();

const authRateLimit = rateLimit({
  windowMs: 60_000,
  maxRequests: 10,
  message: "Demasiados intentos. Probá nuevamente en un minuto.",
});

router.post("/login", authRateLimit, loginController);
router.post("/refresh", rateLimit({ windowMs: 60000, maxRequests: 60 }), refreshTokenController);
router.patch("/change-password", authenticate, rateLimit({ windowMs: 60000, maxRequests: 5 }), changePasswordController);
router.get("/me", authenticate, async (req, res) => {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.userId }, include: { profile: true } });
  res.json(mapSafeUser(user,req.user!.role));
});
router.post("/access-mode", authenticate, rateLimit({windowMs:60000,maxRequests:10}), async(req,res)=>{
  const {mode}=z.object({mode:z.enum(["PERSONAL","GUARD"])}).strict().parse(req.body);
  res.json(await serializable(async tx=>{
    const user=await tx.user.findUniqueOrThrow({where:{id:req.user!.userId},include:{profile:true}});
    if(user.mustChangePassword)throw new OperationError(403,"Cambie su contraseña inicial antes de cambiar de función");
    if(mode==="GUARD"&&!guardFunctionAllowed(user.guardEligible,user.profile?.rank))throw new OperationError(403,"Administración debe habilitar su función de guardia");
    const changed=await tx.authSession.updateMany({where:{id:req.user!.sessionId,userId:user.id,revokedAt:null,expiresAt:{gt:new Date()}},data:{guardMode:mode==="GUARD"}});
    if(!changed.count)throw new OperationError(401,"Sesión no disponible");
    await tx.auditLog.create({data:{actorUserId:user.id,action:"SESSION_ACCESS_MODE_CHANGED",entityType:"AuthSession",entityId:req.user!.sessionId!,metadata:{mode}}});
    return mapSafeUser(user,mode==="GUARD"?"GUARD":undefined);
  }));
});
router.get("/sessions", authenticate, async (req, res) => {
  res.json(await listSessions(req.user!.userId, req.user!.sessionId!));
});
router.delete("/sessions", authenticate, async (req, res) => {
  res.json(await revokeOtherSessions(req.user!.userId, req.user!.sessionId!));
});
router.delete("/sessions/:id", authenticate, async (req, res) => {
  res.json(await revokeSession(req.user!.userId, String(req.params.id)));
});
router.post("/logout", authenticate, async (req, res) => {
  res.json(await revokeSession(req.user!.userId, req.user!.sessionId!));
});

export default router;
