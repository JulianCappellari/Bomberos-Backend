import {Router} from "express";
import {createHash} from "node:crypto";
import {z} from "zod";
import {authorize} from "../../middlewares/role.middleware";
import {serializable} from "../../utils/transaction";
import {OperationError} from "../operations/operations.schemas";
import {fuelSchema,waterSchema} from "./fleet.schemas";
import {recordFuelIn,recordWaterIn} from "./fleet.service";
import {financeAccess} from "../../utils/finance-access";
const router=Router();
const input=z.object({revision:z.number().int().positive(),reason:z.string().trim().min(10).max(1000),data:z.unknown()}).strict();
const digest=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
router.post("/fuel/:id/correct",authorize("ADMIN","OPERATOR"),async(req,res)=>{
 const id=String(req.params.id),correction=input.parse(req.body),data=fuelSchema.parse(correction.data),actor=req.user!;
 res.status(201).json(await serializable(async tx=>{
   const previous=await tx.fuelRecord.findUnique({where:{operationKey:data.operationKey}});
   if(previous){
     if(previous.replacesId!==id||previous.createdByUserId!==actor.userId||previous.requestHash!==digest(data)||previous.correctionReason!==correction.reason)throw new OperationError(409,"La clave corresponde a otra operación");
     return {id:previous.id,replayed:true};
   }
   const old=await tx.fuelRecord.findUnique({where:{id}});
   if(!old||old.voidedAt||old.revision!==correction.revision)throw new OperationError(409,"La carga cambió o ya fue anulada");
   await tx.fuelRecord.update({where:{id},data:{voidedAt:new Date(),voidReason:"Rectificada: "+correction.reason,revision:{increment:1}}});
   const replacement=await recordFuelIn(tx,data,actor,old.assetId);
   await tx.fuelRecord.update({where:{id:replacement.id},data:{replacesId:id,correctionReason:correction.reason}});
   await tx.auditLog.create({data:{actorUserId:actor.userId,action:"FUEL_CORRECTED",entityType:"FuelRecord",entityId:id,metadata:{replacementId:replacement.id,reason:correction.reason,
     before:{assetId:old.assetId,occurredAt:old.occurredAt.toISOString(),volumeMilliliters:old.volumeMilliliters,costCents:old.costCents,odometer:old.odometer,reason:old.reason,notes:old.notes},
     after:{assetId:data.assetId,occurredAt:data.occurredAt,volumeMilliliters:data.liters!,costCents:data.costCents??null,odometer:data.odometer??null,reason:data.reason,notes:data.notes}}}});
   return {id:replacement.id,replayed:false};
 }));
});
router.post("/water/:id/correct",authorize("ADMIN","OPERATOR"),async(req,res)=>{
 const id=String(req.params.id),correction=input.parse(req.body),data=waterSchema.parse(correction.data),actor=req.user!;
 res.status(201).json(await serializable(async tx=>{
   const previous=await tx.waterTrip.findUnique({where:{operationKey:data.operationKey}});
   if(previous){
     if(previous.replacesId!==id||previous.createdByUserId!==actor.userId||previous.requestHash!==digest(data)||previous.correctionReason!==correction.reason)throw new OperationError(409,"La clave corresponde a otra operación");
     return {id:previous.id,replayed:true};
   }
   const old=await tx.waterTrip.findUnique({where:{id},include:{crew:true}});
   if(!old||old.voidedAt||old.revision!==correction.revision)throw new OperationError(409,"El viaje cambió o ya fue anulado");
   if(old.earningsApprovedAt&&!(await financeAccess(actor.userId,actor.role)).canManage)throw new OperationError(403,"Solo acceso financiero puede rectificar un viaje con deuda reconocida");
   if(old.clientPaidAt||old.crew.some(m=>m.paidAt))throw new OperationError(409,"Revierta primero las constancias de cobro y pago");
   await tx.waterTrip.update({where:{id},data:{voidedAt:new Date(),voidReason:"Rectificado: "+correction.reason,revision:{increment:1}}});
   const replacement=await recordWaterIn(tx,data,actor,{assetId:old.assetId,userIds:old.crew.map(m=>m.userId)});
   await tx.waterTrip.update({where:{id:replacement.id},data:{replacesId:id,correctionReason:correction.reason}});
   const {operationKey:_,...after}=data;
   await tx.auditLog.create({data:{actorUserId:actor.userId,action:"WATER_TRIP_CORRECTED",entityType:"WaterTrip",entityId:id,metadata:{replacementId:replacement.id,reason:correction.reason,
     before:{assetId:old.assetId,customer:old.customer,destination:old.destination,departedAt:old.departedAt.toISOString(),returnedAt:old.returnedAt.toISOString(),startOdometer:old.startOdometer,endOdometer:old.endOdometer,tripCount:old.tripCount,chargeCents:old.chargeCents,leaderUserId:old.leaderUserId,notes:old.notes,crew:old.crew.map(m=>({userId:m.userId,compensationCents:m.compensationCents}))},after}}});
   return {id:replacement.id,replayed:false};
 }));
});
export default router;
