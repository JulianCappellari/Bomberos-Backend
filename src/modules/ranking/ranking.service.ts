import {Prisma} from "@prisma/client";
import {randomInt} from "node:crypto";
import {prisma} from "../../config/prisma";
import {serializable} from "../../utils/transaction";
import {stationDate} from "../../utils/station-time";
import {normalizeRank} from "../../utils/firefighter-ranks";
import {shiftInterval} from "../shifts/shifts.rules";
import {reportBounds} from "../operations/reports.service";
import {OperationError} from "../operations/operations.schemas";
import {defaults,policySchema,unpaidMinutes,overdue,creditedControls} from "./ranking.rules";
import {sanctionPoints} from "../sanctions/sanctions";
export async function calculateRanking(tx:Prisma.TransactionClient,month:string){
 const {start,end}=reportBounds(month),now=new Date(),today=stationDate();
 const saved=await tx.rankingPolicy.findUnique({where:{id:"main"}}),policy=saved?policySchema.parse(saved.config):defaults;
 const users=await tx.user.findMany({where:{isActive:true,isPendingApproval:false,deletedAt:null},select:{id:true,username:true,role:true,profile:{select:{fullName:true,rank:true}}}});
 const attendance=await tx.attendance.findMany({where:{status:"CLOSED",checkInQrId:{not:null},checkInAt:{lt:end},checkOutAt:{gt:start},checkInTrust:{not:"REJECTED"},discardedAt:null,checkOutTrust:{not:"REJECTED"}},select:{userId:true,checkInAt:true,checkOutAt:true}});
 const shifts=await tx.shiftAssignment.findMany({where:{shift:{date:{gte:new Date(+start-86400000),lt:end}}},include:{shift:true}});
 const tasks=await tx.workTask.findMany({where:{OR:[{members:{some:{declinedAt:{gte:start,lt:end}}}},{completedAt:{gte:start,lt:end}},{dueOn:{gte:new Date(month+"-01"),lt:new Date(end.toISOString().slice(0,10))}}]},include:{members:true}});
 const declines=await tx.workTaskEvent.findMany({where:{action:"DECLINE",createdAt:{gte:start,lt:end}},select:{actorUserId:true,taskId:true}});
 const inspections=await tx.inspectionResponsible.findMany({where:{confirmedAt:{not:null},inspection:{confirmationsComplete:true,voidedAt:null,inspectionDate:{gte:new Date(+new Date(month+"-01")-7*86400000),lt:new Date(end.toISOString().slice(0,10))}}},select:{userId:true,inspection:{select:{vehicleId:true,inspectionDate:true}}}});
 const courses=await tx.courseAttendance.findMany({where:{status:"APPROVED",completedOn:{gte:new Date(month+"-01"),lt:new Date(end.toISOString().slice(0,10))}},select:{userId:true}});
 const movements=await tx.missionMovement.findMany({where:{departedAt:{lt:end},OR:[{returnedAt:null},{returnedAt:{gt:start}}]},include:{crew:true,departure:{select:{voidedAt:true}}}});
 const sanctioned=await sanctionPoints(tx,month);
 const sheets=await tx.incidentSheet.findMany({where:{finalizedAt:{gte:start,lt:end},incident:{voidedAt:null}},select:{incidentId:true,baseUserIds:true}});
 const participants=await tx.missionCrew.findMany({where:{movement:{incidentId:{in:sheets.map(s=>s.incidentId)},returnedAt:{not:null},departure:{voidedAt:null}}},select:{userId:true,movement:{select:{incidentId:true}}}});
 const rows=users.filter(u=>normalizeRank(u.profile?.rank)!=="administrador").map(u=>{
  const clip=(a:Date,b:Date)=>({start:Math.max(+start,+a),end:Math.min(+end,+now,+b)});
  const presence=attendance.filter(a=>a.userId===u.id&&a.checkInAt&&a.checkOutAt).map(a=>clip(a.checkInAt!,a.checkOutAt!));
  const paid=shifts.filter(s=>s.userId===u.id).map(({shift:s})=>shiftInterval(s.date.toISOString().slice(0,10),s.period==="DAY"?"08:00":s.period==="NIGHT"?"20:00":s.startTime,s.period==="DAY"?"20:00":s.period==="NIGHT"?"08:00":s.endTime));
  const away=movements.filter(m=>m.crew.some(c=>c.userId===u.id)).map(m=>clip(m.departedAt,m.returnedAt||now));
  const minutes=u.role==="GUARD"||normalizeRank(u.profile?.rank)==="guardia"?0:unpaidMinutes(presence,[...paid,...away]);
  const own=tasks.filter(t=>t.members.some(m=>m.userId===u.id));
  const verified=own.filter(t=>t.members.some(m=>m.userId===u.id&&!m.declinedAt)&&t.status==="VERIFIED"&&t.officerApproved&&t.completedAt&&t.completedAt>=start&&t.completedAt<end).length;
  const missed=own.filter(t=>t.dueOn&&t.dueOn.toISOString().startsWith(month)&&overdue(t,today)).length;
  // K06: cada "No puedo" del mes descuenta puntos.
  const personalDeclines=declines.filter(event=>event.actorUserId===u.id);
  const legacyDeclines=own.filter(t=>!personalDeclines.some(event=>event.taskId===t.id)&&t.members.some(m=>m.userId===u.id&&m.declinedAt&&m.declinedAt>=start&&m.declinedAt<end)).length;
  const declined=personalDeclines.length+legacyDeclines;
  const incidents=new Set([...sheets.filter(s=>s.baseUserIds.includes(u.id)).map(s=>s.incidentId),...participants.filter(p=>p.userId===u.id).map(p=>p.movement.incidentId)]).size;
  const inspectionCredits=creditedControls(inspections.filter(i=>i.userId===u.id).map(i=>i.inspection),month);
  const breakdown={hours:Math.floor(minutes*policy.hour/60),tasks:verified*policy.task,inspections:inspectionCredits*policy.inspection,incidents:incidents*policy.incident,courses:courses.filter(c=>c.userId===u.id).length*policy.course,penalties:missed*policy.missedTask+declined*policy.declinedTask,sanctions:sanctioned.get(u.id)??0};
  const counters={voluntaryMinutes:minutes,tasks:verified,inspections:inspectionCredits,incidents,courses:courses.filter(c=>c.userId===u.id).length,missedTasks:missed,declinedTasks:declined};
  return {userId:u.id,name:u.profile?.fullName||u.username,rank:u.profile?.rank,minutes,counters,breakdown,points:breakdown.hours+breakdown.tasks+breakdown.inspections+breakdown.incidents+breakdown.courses-breakdown.penalties-breakdown.sanctions};
 }).sort((a,b)=>b.points-a.points||a.userId.localeCompare(b.userId));
 // Rango bajo: por debajo de la mitad del promedio de puntos del cuerpo activo (sin Comision Directiva ni guardias).
 const scored=rows.filter(r=>countsForAverage(r.rank));
 const average=scored.length?scored.reduce((t,r)=>t+r.points,0)/scored.length:0;
 const lowLine=Math.round(average/2*10)/10;
 return {month,policy,policyRevision:saved?.revision||0,generatedAt:now,average:Math.round(average*10)/10,lowLine,rows:rows.map((r)=>({...r,position:rows.findIndex(p=>p.points===r.points)+1,low:countsForAverage(r.rank)&&r.points<lowLine}))};
}
export const countsForAverage=(rank?:string|null)=>!["comision directiva","guardia","administrador"].includes(normalizeRank(rank));
export async function ranking(month:string){return prisma.$transaction(tx=>calculateRanking(tx,month),{isolationLevel:"RepeatableRead"});}
// L09: jefatura elige sortear solo entre quienes tienen puntaje bajo o entre todo el personal.
export async function assignRecovery(month:string,revision:number,actorId:string,scope:"LOW"|"ALL"="LOW"){
 if(month!==stationDate().slice(0,7))throw new OperationError(400,"Solo se asigna recuperación del mes actual");
 return serializable(async tx=>{
  const board=await calculateRanking(tx,month);
  if(board.policyRevision!==revision)throw new OperationError(409,"Las reglas cambiaron. Recargue el ranking");
  const templates=await tx.rankingTemplate.findMany({where:{active:true},orderBy:{id:"asc"}});
  if(!templates.length)throw new OperationError(409,"Cargue al menos una tarea de recuperación habilitada");
  const created=[];
  for(const row of board.rows.filter(r=>scope==="ALL"||r.low)){
   if(["aspirante menor","comision directiva"].includes(normalizeRank(row.rank)))continue;
   const key=month+":"+row.userId+(scope==="ALL"?":"+stationDate():"");
   if(await tx.workTask.findUnique({where:{rankingRecoveryKey:key}}))continue;
   if(await tx.workTaskMember.findFirst({where:{userId:row.userId,declinedAt:null,task:{status:{in:["ASSIGNED","RETURNED","SUBMITTED"]}}}}))continue;
   if(await tx.emergencyAvailability.findFirst({where:{userId:row.userId,cancelledAt:null,startsAt:{lte:new Date()},OR:[{endsAt:null},{endsAt:{gt:new Date()}}]}}))continue;
   const template=templates[randomInt(templates.length)]!;
   const due=new Date(Date.now()+board.policy.recoveryDays*86400000);
   const task=await tx.workTask.create({data:{rankingRecoveryKey:key,title:template.title,description:template.description,dueOn:new Date(stationDate(due)),createdByUserId:actorId,members:{create:{userId:row.userId}}}});
   await tx.workTaskEvent.create({data:{taskId:task.id,actorUserId:actorId,action:"CREATED",notes:"Tarea asignada por jefatura"}});
   await tx.auditLog.create({data:{actorUserId:actorId,action:"RANKING_RECOVERY_ASSIGNED",entityType:"WorkTask",entityId:task.id,metadata:{month,userId:row.userId,points:row.points,threshold:board.lowLine,average:board.average,scope,templateId:template.id,templateRevision:template.revision,policyRevision:revision}}});
   created.push({taskId:task.id,userId:row.userId,title:task.title});
  }
  return {created};
 });
}
