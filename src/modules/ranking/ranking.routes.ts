import { requireStepUp } from "../../middlewares/step-up.middleware";
import {Router} from "express";
import {z} from "zod";
import {authenticate} from "../../middlewares/auth.middleware";
import {authorize} from "../../middlewares/role.middleware";
import {prisma} from "../../config/prisma";
import {serializable} from "../../utils/transaction";
import {stationDate} from "../../utils/station-time";
import {OperationError} from "../operations/operations.schemas";
import {policySchema} from "./ranking.rules";
import {ranking,assignRecovery} from "./ranking.service";
const router=Router();router.use(authenticate,authorize("ADMIN"));
const month=z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).default(()=>stationDate().slice(0,7));
router.get("/",async(req,res)=>res.json(await ranking(month.parse(req.query.month))));
router.get("/templates",async(_req,res)=>res.json(await prisma.rankingTemplate.findMany({orderBy:{createdAt:"asc"}})));
router.put("/policy",requireStepUp,async(req,res)=>{
 const input=z.object({revision:z.number().int().min(0),config:policySchema,reason:z.string().trim().min(10).max(1000)}).strict().parse(req.body);
 res.json(await serializable(async tx=>{
  const old=await tx.rankingPolicy.findUnique({where:{id:"main"}});
  if((old?.revision||0)!==input.revision)throw new OperationError(409,"Las reglas cambiaron");
  const row=await tx.rankingPolicy.upsert({where:{id:"main"},create:{config:input.config},update:{config:input.config,revision:{increment:1}}});
  await tx.auditLog.create({data:{actorUserId:req.user!.userId,action:"RANKING_POLICY_UPDATED",entityType:"RankingPolicy",entityId:"main",metadata:{before:old?.config||null,after:input.config,reason:input.reason,revision:row.revision}}});return row;
 }));
});
const template=z.object({title:z.string().trim().min(3).max(160),description:z.string().trim().min(10).max(4000),active:z.boolean()}).strict();
router.post("/templates",async(req,res)=>{
 const input=template.parse(req.body);
 res.status(201).json(await serializable(async tx=>{const row=await tx.rankingTemplate.create({data:input});await tx.auditLog.create({data:{actorUserId:req.user!.userId,action:"RANKING_TEMPLATE_CREATED",entityType:"RankingTemplate",entityId:row.id,metadata:input}});return row;}));
});
router.put("/templates/:id",async(req,res)=>{
 const {revision,...data}=template.extend({revision:z.number().int().positive()}).parse(req.body),id=String(req.params.id);
 res.json(await serializable(async tx=>{const old=await tx.rankingTemplate.findUnique({where:{id}});if(!old||old.revision!==revision)throw new OperationError(409,"La plantilla cambió");await tx.rankingTemplate.update({where:{id},data:{...data,revision:{increment:1}}});await tx.auditLog.create({data:{actorUserId:req.user!.userId,action:"RANKING_TEMPLATE_UPDATED",entityType:"RankingTemplate",entityId:id,metadata:{before:old,after:data}}});return {message:"Plantilla actualizada"};}));
});
router.post("/recovery",async(req,res)=>{const input=z.object({month,policyRevision:z.number().int().min(0),scope:z.enum(["LOW","ALL"]).default("LOW")}).strict().parse(req.body);res.status(201).json(await assignRecovery(input.month,input.policyRevision,req.user!.userId,input.scope));});
export default router;
