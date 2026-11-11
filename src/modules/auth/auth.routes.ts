import bcrypt from "bcrypt";
import { issueStepUpToken, STEP_UP_MINUTES } from "../../middlewares/step-up.middleware";
import { Router } from "express";
import { z } from "zod";
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
    if(mode==="GUARD")throw new OperationError(410,"La guardia ahora usa una cuenta propia, con otro usuario y contraseña. Pedile a administración que te la cree");
    // Solo queda salir del antiguo modo guardia: vuelve a personal y apaga los QR que haya generado.
    const changed=await tx.authSession.updateMany({where:{id:req.user!.sessionId,userId:user.id,revokedAt:null,expiresAt:{gt:new Date()}},data:{guardMode:false}});
    if(!changed.count)throw new OperationError(401,"Sesión no disponible");
    await tx.qrChallenge.updateMany({where:{createdByUserId:user.id,revokedAt:null,expiresAt:{gt:new Date()}},data:{revokedAt:new Date()}});
    await tx.auditLog.create({data:{actorUserId:user.id,action:"SESSION_ACCESS_MODE_CHANGED",entityType:"AuthSession",entityId:req.user!.sessionId!,metadata:{mode}}});
    return mapSafeUser(user);
  }));
});
router.post("/confirm", authenticate, rateLimit({ windowMs: 60000, maxRequests: 12 }), async (req, res) => {
  const { password } = z.object({ password: z.string().min(1).max(200) }).strict().parse(req.body);
  const user = await prisma.user.findUnique({ where: { id: req.user!.userId }, select: { passwordHash: true } });
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    await prisma.auditLog.create({ data: { actorUserId: req.user!.userId, action: "AUTH_STEP_UP_FAILED", entityType: "AuthSession", entityId: req.user!.sessionId! } });
    // Anti-robo de celular: 5 confirmaciones fallidas en 10 minutos cierran esta sesion.
    const fails = await prisma.auditLog.count({ where: { action: "AUTH_STEP_UP_FAILED", entityId: req.user!.sessionId!, createdAt: { gt: new Date(Date.now() - 10 * 60_000) } } });
    if (fails >= 5) {
      await prisma.authSession.updateMany({ where: { id: req.user!.sessionId!, revokedAt: null }, data: { revokedAt: new Date() } });
      await prisma.auditLog.create({ data: { actorUserId: req.user!.userId, action: "AUTH_STEP_UP_SESSION_CLOSED", entityType: "AuthSession", entityId: req.user!.sessionId! } });
      return res.status(401).json({ message: "Demasiados intentos: por seguridad se cerró la sesión. Volvé a ingresar." });
    }
    return res.status(403).json({ message: "La contraseña no es correcta." });
  }
  await prisma.auditLog.create({ data: { actorUserId: req.user!.userId, action: "AUTH_STEP_UP_CONFIRMED", entityType: "AuthSession", entityId: req.user!.sessionId! } });
  res.json({ token: issueStepUpToken(req.user!.userId, req.user!.sessionId!), expiresInMinutes: STEP_UP_MINUTES });
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
