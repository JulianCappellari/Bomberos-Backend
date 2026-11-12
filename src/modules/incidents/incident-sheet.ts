import { Prisma } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../config/prisma";
import { serializable } from "../../utils/transaction";
import { canWriteIncident, requireIncidentWrite } from "./incident-access";
import { PUBLIC_USER_SELECT } from "../../utils/public-user";
import { OperationError } from "../operations/operations.schemas";
import { unionMilliseconds } from "../operations/reports.service";
import { lockRow } from "../../utils/database-schema";

const unique = (ids: string[]) => new Set(ids).size === ids.length;
// Clasificacion de la constancia en papel ("poner X a lo que corresponda").
export const INCIDENT_CLASSIFICATIONS = ["INCENDIO_VEHICULAR", "INCENDIO_ESTRUCTURAL", "INCENDIO_FORESTAL", "INCENDIO_INDUSTRIAL", "INUNDACION", "RESCATE_PERSONA", "PREVENCION", "COOPERACIONES_VARIAS", "ACCIDENTE_VEHICULAR", "PERDIDA_GAS", "RESCATE_ANIMAL", "FALSA_ALARMA", "OTROS"] as const;
const form = z.object({
  revision:z.number().int().min(0), callerName:z.string().trim().max(120).optional().default(""), callerPhone:z.string().trim().max(40).regex(/^[+\d ()-]*$/).optional().default(""),
  addressNumber:z.string().trim().max(40).optional().default(""), receivedBy:z.string().trim().max(120).optional().default(""), firefightersOnScene:z.string().trim().max(1000).optional().default(""),
  classifications:z.array(z.enum(INCIDENT_CLASSIFICATIONS)).max(INCIDENT_CLASSIFICATIONS.length).refine(unique,"Clasificación repetida").optional().default([]), classificationDetail:z.string().trim().max(300).optional().default(""), notes:z.string().trim().min(10).max(4000),
  baseUserIds:z.array(z.string().min(1).max(100)).max(150).refine(unique),
  materials:z.array(z.object({name:z.string().trim().min(2).max(140),quantity:z.number().int().positive().max(100000),notes:z.string().trim().max(500)}).strict()).max(100),
  evidenceUrls:z.array(z.string().url().max(500).refine(value=>{try{const u=new URL(value);return u.protocol==="https:"&&!u.username&&!u.password;}catch{return false;}})).max(5).refine(unique),
}).strict();

export async function incidentSheetContext(tx:Prisma.TransactionClient,id:string,until:Date){
  const incident=await tx.incident.findUnique({where:{id},select:{id:true,requestYear:true,requestNumber:true,title:true,type:true,description:true,location:true,occurredAt:true,closedAt:true,status:true,voidedAt:true,voidReason:true,replacesIncidentId:true,
    alert:{select:{id:true,createdAt:true,contactPhone:true,createdBy:{select:{username:true,profile:{select:{fullName:true}}}},originNotice:{select:{source:true,phone:true,receivedAt:true}},responses:{where:{response:"GOING"},select:{id:true,userId:true,attendanceOutcome:true}}}},
    movements:{orderBy:{departedAt:"asc"},select:{id:true,assetId:true,asset:{select:{name:true,status:true,vehicle:{select:{unitNumber:true}}}},driverUserId:true,leaderUserId:true,driver:{select:PUBLIC_USER_SELECT},leader:{select:PUBLIC_USER_SELECT},departedAt:true,arrivedAt:true,returnedAt:true,returnWithoutArrivalReason:true,dispatchExceptionReason:true,departure:{select:{voidedAt:true}},crew:{select:{userId:true,user:{select:PUBLIC_USER_SELECT}}}}},
    agencies:{where:{voidedAt:null},orderBy:{createdAt:"asc"},select:{agencyType:true,name:true,unit:true,inCharge:true}}}});
  if(!incident)throw new OperationError(404,"Intervención no encontrada");
  if(incident.closedAt && incident.closedAt < until) until=incident.closedAt;
  const people=await tx.attendance.findMany({where:{checkInQrId:{not:null},checkInAt:{lt:until},checkInTrust:{not:"REJECTED"},OR:[{checkOutAt:{gt:incident.occurredAt}},{status:"OPEN"}]},select:{userId:true,checkInAt:true,checkOutAt:true,user:{select:{username:true,profile:{select:{fullName:true}}}}}});
  const missions=people.length?await tx.missionCrew.findMany({where:{userId:{in:people.map(p=>p.userId)},movement:{departedAt:{lt:until},OR:[{returnedAt:null},{returnedAt:{gt:incident.occurredAt}}]}},select:{userId:true,movement:{select:{departedAt:true,returnedAt:true}}}}):[];
  // Una persona puede estar en la base y salir despues en otra unidad (o volver y quedar en base):
  // la base son los tramos con presencia QR que no se superponen con ninguna salida.
  const base=new Map<string,string>(), segments=new Map<string,Array<{from:Date;to:Date}>>();
  for(const p of people){
    const start=Math.max(+incident.occurredAt,+p.checkInAt!),end=Math.min(+until,+(p.checkOutAt||until));
    const away=missions.filter(m=>m.userId===p.userId).map(m=>({start:Math.max(start,+m.movement.departedAt),end:Math.min(end,+(m.movement.returnedAt||until))})).filter(m=>m.end>m.start);
    if(end-start>unionMilliseconds(away)){
      base.set(p.userId,p.user.profile?.fullName||p.user.username);
      let cursor=start;const free:Array<{from:Date;to:Date}>=[];
      for(const a of away.sort((x,y)=>x.start-y.start)){if(a.start>cursor)free.push({from:new Date(cursor),to:new Date(a.start)});cursor=Math.max(cursor,a.end);}
      if(end>cursor)free.push({from:new Date(cursor),to:new Date(end)});
      segments.set(p.userId,[...(segments.get(p.userId)||[]),...free.filter(f=>+f.to-+f.from>=60000)]);
    }
  }
  // G06/G14: quien recibio la alerta y respondio "Voy" puede figurar en la planilla sin escanear el QR,
  // salvo durante el tiempo en que integro una dotacion en salida.
  const going=incident.alert?.responses.map(r=>r.userId).filter(id=>!base.has(id))||[];
  if(going.length){
    const deployed=new Set(incident.movements.filter(m=>+m.departedAt<=+incident.occurredAt&&(!m.returnedAt||+m.returnedAt>=+until)).flatMap(m=>m.crew.map(c=>c.userId)));
    const users=await tx.user.findMany({where:{id:{in:going},isActive:true,isPendingApproval:false,deletedAt:null},select:{id:true,username:true,profile:{select:{fullName:true}}}});
    for(const u of users)if(!deployed.has(u.id))base.set(u.id,u.profile?.fullName||u.username);
  }
  // Personal actuante (integra una salida de esta intervencion) no figura en base. Si se corrige la dotacion
  // y deja de integrarla, vuelve a aparecer solo.
  const acting=new Set(incident.movements.filter(m=>!m.departure?.voidedAt).flatMap(m=>m.crew.map(c=>c.userId)));
  for(const id of acting)base.delete(id);
  return {incident,baseCandidates:[...base].map(([id,name])=>({id,name,segments:segments.get(id)||[],respondedOnly:!segments.has(id)}))};
}
export async function finalizeSheet(tx:Prisma.TransactionClient,id:string,now:Date,actor:string){
  const data=await incidentSheetContext(tx,id,now);
  let sheet=await tx.incidentSheet.findUnique({where:{incidentId:id}});
  // G13: con los moviles retornados la intervencion puede finalizarse aunque falten datos;
  // lo pendiente se completa despues mediante anexos (G18).
  const dataPending=!sheet;
  if(!sheet)sheet=await tx.incidentSheet.create({data:{incidentId:id,authorId:actor,receivedBy:data.incident.alert?.createdBy.profile?.fullName||data.incident.alert?.createdBy.username||"",callerName:data.incident.alert?.originNotice?.source||"",callerPhone:data.incident.alert?.originNotice?.phone||data.incident.alert?.contactPhone||"",notes:"Intervención finalizada con datos pendientes de carga. Complete la información mediante anexos.",baseUserIds:[],materials:[],evidenceUrls:[]}});
  const staleBase=sheet.baseUserIds.filter(user=>!data.baseCandidates.some(p=>p.id===user));
  if(staleBase.length)throw new OperationError(409,"La presencia en base cambió; revise la planilla");
  const participants=new Set([...sheet.baseUserIds,...data.incident.movements.filter(m=>m.returnedAt&&m.departure&&!m.departure.voidedAt).flatMap(m=>m.crew.map(c=>c.userId))]);
  // Decision del cuartel: quien respondio "Voy" y no figura en una dotacion retornada ni en el
  // personal en base pierde esa respuesta, como si nunca la hubiera dado. Queda constancia en auditoria.
  // Sin planilla guardada no hay base para afirmar la inasistencia, asi que no se borra nada.
  const noShows=dataPending?[]:data.incident.alert?.responses.filter(r=>!participants.has(r.userId))||[];
  const notCredited=noShows.map(r=>r.userId);
  if(data.incident.alert&&noShows.length){
    const removed=await tx.alertResponse.deleteMany({where:{id:{in:noShows.map(r=>r.id)},response:"GOING"}});
    if(removed.count){
      await tx.auditLog.createMany({data:noShows.map(response=>({
        actorUserId:actor,
        action:"ALERT_GOING_REMOVED_NO_SHOW",
        entityType:"Alert",
        entityId:data.incident.alert!.id,
        metadata:{alertId:data.incident.alert!.id,incidentId:id,userId:response.userId,removedResponse:"GOING",recordedAt:now.toISOString()},
      }))});
    }
  }
  await tx.incidentSheet.update({where:{incidentId:id},data:{finalizedAt:now,revision:{increment:1},finalContext:JSON.parse(JSON.stringify({...data,incident:{...data.incident,status:"CLOSED",closedAt:now},notCredited,dataPending}))}});
  await tx.auditLog.create({data:{actorUserId:actor,action:"INCIDENT_SHEET_FINALIZED",entityType:"Incident",entityId:id,metadata:{sheetAuthor:sheet.authorId,participants:[...participants],unconfirmedGoing:notCredited,dataPending}}});
}
const router=Router({mergeParams:true});
router.get("/",async(req,res)=>{
  const {id}=z.object({id:z.string().min(1)}).parse(req.params),actor=req.user!;
  res.json(await prisma.$transaction(async tx=>{
    const sheet=await tx.incidentSheet.findUnique({where:{incidentId:id},include:{author:{select:{username:true,profile:{select:{fullName:true}}}}}});
    const mayWrite=await canWriteIncident(tx,actor);
    if(sheet?.finalizedAt){
      const state=await tx.incident.findUniqueOrThrow({where:{id},select:{voidedAt:true,voidReason:true,replacesIncidentId:true}});
      sheet.finalContext={...(sheet.finalContext as object),incident:{...((sheet.finalContext as {incident:object}).incident),...state}} as Prisma.JsonValue;
      const amendments=await tx.auditLog.findMany({where:{entityType:"Incident",entityId:id,action:"INCIDENT_SHEET_AMENDED"},orderBy:[{createdAt:"asc"},{id:"asc"}],select:{id:true,createdAt:true,metadata:true,actor:{select:{username:true}}}});
      const notebookEntries=await tx.incidentNotebookEntry.findMany({where:{incidentId:id,deletedAt:null},include:{author:{select:PUBLIC_USER_SELECT}},orderBy:[{occurredAt:"asc"},{id:"asc"}],take:500});
      return {sheet,context:sheet.finalContext,canWrite:false,canAddAnnex:mayWrite,amendments,notebookEntries};
    }
    const current=await incidentSheetContext(tx,id,new Date());
    const notebookEntries=await tx.incidentNotebookEntry.findMany({where:{incidentId:id,deletedAt:null},include:{author:{select:PUBLIC_USER_SELECT}},orderBy:[{occurredAt:"asc"},{id:"asc"}],take:500});
    return {sheet,context:current,canWrite:current.incident.status==="OPEN"&&mayWrite,canAddAnnex:current.incident.status==="CLOSED"&&mayWrite,notebookEntries};
  },{isolationLevel:"RepeatableRead"}));
});
router.put("/",async(req,res)=>{
  const {id}=z.object({id:z.string().min(1)}).parse(req.params),actor=req.user!,{revision,...data}=form.parse(req.body);
  res.json(await serializable(async tx=>{
    await lockRow(tx, "Incident", id);
    await requireIncidentWrite(tx,actor);
    const snapshot=await incidentSheetContext(tx,id,new Date());
    if(snapshot.incident.status!=="OPEN")throw new OperationError(409,"La intervención está cerrada");
    const old=await tx.incidentSheet.findUnique({where:{incidentId:id}});
    if((old?.revision||0)!==revision)throw new OperationError(409,"La planilla cambió. Recargue antes de editar");
    if(data.baseUserIds.some(user=>!snapshot.baseCandidates.some(p=>p.id===user)))throw new OperationError(400,"Seleccione personal con presencia QR durante la intervención o que haya respondido Voy a la convocatoria");
    const row=old?await tx.incidentSheet.update({where:{incidentId:id},data:{...data,revision:{increment:1}}}):await tx.incidentSheet.create({data:{...data,incidentId:id,authorId:actor.userId}});
    await tx.auditLog.create({data:{actorUserId:actor.userId,action:old?"INCIDENT_SHEET_UPDATED":"INCIDENT_SHEET_CREATED",entityType:"Incident",entityId:id,metadata:{revision:row.revision,before:old?{callerName:old.callerName,callerPhone:old.callerPhone,addressNumber:old.addressNumber,receivedBy:old.receivedBy,firefightersOnScene:old.firefightersOnScene,classifications:old.classifications,classificationDetail:old.classificationDetail,notes:old.notes,materials:old.materials,baseUserIds:old.baseUserIds,evidenceUrls:old.evidenceUrls}:null,after:data} as Prisma.InputJsonValue}});
    return row;
  }));
});
router.post("/amendments",async(req,res)=>{
  const actor=req.user!,{id}=z.object({id:z.string().min(1)}).parse(req.params);
  if(!["ADMIN","OPERATOR"].includes(actor.role))throw new OperationError(403,"Solo jefatura puede agregar enmiendas a una planilla cerrada");
  const input=z.object({revision:z.number().int().positive(),reason:z.string().trim().min(10).max(1000),correction:z.string().trim().min(10).max(4000)}).strict().parse(req.body);
  res.status(201).json(await serializable(async tx=>{
    const sheet=await tx.incidentSheet.findUnique({where:{incidentId:id}});
    if(!sheet?.finalizedAt)throw new OperationError(409,"Solo se enmiendan planillas finalizadas");
    const changed=await tx.incidentSheet.updateMany({where:{incidentId:id,revision:input.revision,finalizedAt:{not:null}},data:{revision:{increment:1}}});
    if(!changed.count)throw new OperationError(409,"La planilla cambió. Recargue antes de agregar la enmienda");
    return tx.auditLog.create({data:{actorUserId:actor.userId,action:"INCIDENT_SHEET_AMENDED",entityType:"Incident",entityId:id,metadata:{reason:input.reason,correction:input.correction,sourceRevision:input.revision,revision:input.revision+1}},select:{id:true,createdAt:true}});
  }));
});
router.patch("/request-number",async(req,res)=>{
  const actor=req.user!,{id}=z.object({id:z.string().min(1)}).parse(req.params);
  if(!["ADMIN","OPERATOR"].includes(actor.role))throw new OperationError(403,"Solo jefatura corrige el número de pedido de auxilio");
  const input=z.object({requestNumber:z.number().int().min(1).max(100000),requestYear:z.number().int().min(2000).max(2100),reason:z.string().trim().min(5).max(500)}).strict().parse(req.body);
  res.json(await serializable(async tx=>{
    await lockRow(tx,"Incident",id);
    const incident=await tx.incident.findUnique({where:{id},select:{requestYear:true,requestNumber:true,voidedAt:true}});
    if(!incident)throw new OperationError(404,"Intervención no encontrada");
    if(incident.voidedAt)throw new OperationError(409,"La intervención está anulada");
    const taken=await tx.incident.findFirst({where:{id:{not:id},voidedAt:null,requestYear:input.requestYear,requestNumber:input.requestNumber},select:{id:true}});
    if(taken)throw new OperationError(409,`El pedido N° ${input.requestNumber}/${input.requestYear} ya está usado en otra intervención`);
    await tx.incident.update({where:{id},data:{requestYear:input.requestYear,requestNumber:input.requestNumber}});
    await tx.auditLog.create({data:{actorUserId:actor.userId,action:"INCIDENT_REQUEST_NUMBER_CHANGED",entityType:"Incident",entityId:id,metadata:{before:`${incident.requestNumber}/${incident.requestYear}`,after:`${input.requestNumber}/${input.requestYear}`,reason:input.reason}}});
    return {requestNumber:input.requestNumber,requestYear:input.requestYear};
  }));
});
export default router;
