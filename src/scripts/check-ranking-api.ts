import { enableAutoStepUp } from "./step-up-test-helper";
import "dotenv/config";
import assert from "node:assert/strict";
import {randomBytes,randomUUID} from "node:crypto";
import {execFileSync} from "node:child_process";
import {PrismaClient} from "@prisma/client";
import bcrypt from "bcrypt";
import {defaults} from "../modules/ranking/ranking.rules";
import {stationDate} from "../utils/station-time";
async function main(){
 if(process.env.NODE_ENV==="production")throw Error("No se prueba en producción");
 const original=process.env.DATABASE_URL!,schema="ranking_verify_"+randomBytes(8).toString("hex"),url=new URL(original);url.searchParams.set("schema",schema);
 const root=new PrismaClient({datasourceUrl:original});let db:PrismaClient|undefined,server:import("node:http").Server|undefined;
 try{
  execFileSync(process.execPath,[require.resolve("prisma/build/index.js"),"migrate","deploy"],{env:{...process.env,DATABASE_URL:url.toString()},stdio:"pipe"});
  process.env.DATABASE_URL=url.toString();const {prisma}=await import("../config/prisma");db=prisma;const {app}=await import("../app");
  server=app.listen(0,"127.0.0.1");await new Promise<void>(r=>server!.once("listening",r));const address=server.address();assert(address&&typeof address!=="string");const base=`http://127.0.0.1:${address.port}/api`;
  let paths=0;async function call(path:string,status:number,token?:string,method="GET",body?:unknown){const response=await fetch(base+path,{method,headers:{"Content-Type":"application/json",...(token?{Authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{})});const data=await response.json();assert.equal(response.status,status,`${path}: ${JSON.stringify(data)}`);paths++;return data;}
  const password=randomUUID()+"!Aa7",passwordHash=await bcrypt.hash(password,10),users:Array<{id:string;username:string}>=[],tokens:string[]=[];
  enableAutoStepUp(() => password);
  for(const [i,rank]of["Administrador","Sub oficial","Bombero","Guardia","Bombero","Oficial"].entries()){
   const user=await prisma.user.create({data:{username:"ranking_test_"+i,role:i===0?"ADMIN":"FIREFIGHTER",passwordHash,profile:{create:{rank,fullName:"Prueba ranking "+i,dni:"RANK-"+i,badge:"RANK-"+i}}}});users.push(user);tokens.push((await call("/auth/login",200,undefined,"POST",{username:user.username,password})).tokens.accessToken);
  }
  const [admin,sub,staff,guard]=tokens;
  for(const token of [sub,staff,guard]){
   await call("/ranking",403,token);await call("/ranking/templates",403,token);
   await call("/ranking/policy",403,token,"PUT",{});await call("/ranking/recovery",403,token,"POST",{});
  }
  await call("/ranking",200,tokens[5]);
  await call("/ranking",401);await call("/ranking?month=invalid",400,admin);
  const monthDate=new Date(stationDate()+"T12:00:00Z");monthDate.setUTCDate(1);monthDate.setUTCMonth(monthDate.getUTCMonth()-1);const month=monthDate.toISOString().slice(0,7),day=month+"-02";
  const station=await prisma.station.create({data:{name:"Base prueba ranking",latitude:-33,longitude:-64}});
  const qr=await prisma.qrChallenge.create({data:{stationId:station.id,tokenHash:randomUUID(),expiresAt:new Date()}});
  for(const userId of[users[2]!.id,users[3]!.id])for(let i=0;i<2;i++)await prisma.attendance.create({data:{userId,stationId:station.id,status:"CLOSED",checkInQrId:qr.id,checkInTrust:"HIGH",checkOutTrust:"HIGH",checkInAt:new Date(day+"T06:00:00-03:00"),checkOutAt:new Date(day+"T16:00:00-03:00")}});
  await prisma.shift.create({data:{date:new Date(day),startTime:"08:00",endTime:"20:00",shiftType:"Guardia pagada",period:"DAY",createdByUserId:users[0]!.id,assignments:{create:{userId:users[2]!.id}}}});
  await prisma.workTask.create({data:{title:"Trabajo verificado",description:"Actividad real validada en prueba",createdByUserId:users[0]!.id,status:"VERIFIED",officerApproved:true,createdAt:new Date(month+"-01T12:00:00-03:00"),completionNotes:"Trabajo realizado con evidencia de prueba",reviewNotes:"Verificado de forma independiente",completedAt:new Date(day+"T07:00:00-03:00"),reviewedAt:new Date(day+"T08:00:00-03:00"),reviewedByUserId:users[1]!.id,members:{create:{userId:users[2]!.id}}}});
  await prisma.workTask.create({data:{title:"Trabajo incumplido",description:"Actividad asignada vencida en prueba",createdAt:new Date(month+"-01T12:00:00-03:00"),createdByUserId:users[0]!.id,dueOn:new Date(day),members:{create:{userId:users[2]!.id}}}});
  const board=await call("/ranking?month="+month,200,admin);assert(!board.rows.some((r:{userId:string})=>r.userId===users[0]!.id));
  const row=board.rows.find((r:{userId:string})=>r.userId===users[2]!.id);assert.equal(row.minutes,120);assert.equal(row.breakdown.hours,4);assert.equal(row.breakdown.tasks,10);assert.equal(row.breakdown.penalties,5);assert.equal(row.points,9);
  assert.deepEqual(row.counters,{voluntaryMinutes:120,tasks:1,inspections:0,incidents:0,courses:0,missedTasks:1,declinedTasks:0});
  assert.equal(board.rows.find((r:{userId:string})=>r.userId===users[3]!.id).minutes,0);
  assert.deepEqual((await call("/ranking?month="+month,200,admin)).rows,board.rows);
  const policy={revision:0,config:defaults,reason:"Reglas de puntaje aprobadas para prueba"};await call("/ranking/policy",403,staff,"PUT",policy);await call("/ranking/policy",200,admin,"PUT",policy);await call("/ranking/policy",409,admin,"PUT",policy);
  assert.equal(await prisma.rankingTemplate.count({where:{active:true}}),3);
  await prisma.rankingTemplate.updateMany({data:{active:false}});
  const recovery={month:stationDate().slice(0,7),policyRevision:1};await call("/ranking/recovery",403,guard,"POST",recovery);await call("/ranking/recovery",409,admin,"POST",recovery);
  const template={title:"Ordenar salón común",description:"Ordenar las mesas sin manipular equipos operativos.",active:true};await call("/ranking/templates",403,staff,"POST",template);const t=await call("/ranking/templates",201,admin,"POST",template);
  // Rango bajo: debajo de la mitad del promedio del mes. users[2] suma puntos este mes; users[4] queda en 0 (en rojo).
  await prisma.workTask.create({data:{title:"Trabajo verificado del mes",description:"Actividad real validada en prueba",createdByUserId:users[0]!.id,status:"VERIFIED",officerApproved:true,completionNotes:"Trabajo realizado con evidencia de prueba",reviewNotes:"Verificado de forma independiente",completedAt:new Date(Date.now()-3600000),reviewedAt:new Date(),reviewedByUserId:users[1]!.id,members:{create:{userId:users[2]!.id}}}});
  const current=await call("/ranking?month="+recovery.month,200,admin);
  assert(current.average>0);assert.equal(current.lowLine,Math.round(current.average/2*10)/10);
  assert.equal(current.rows.find((r:{userId:string})=>r.userId===users[4]!.id).low,true,"Sin puntos y con promedio positivo: rango bajo");
  assert.equal(current.rows.find((r:{userId:string})=>r.userId===users[2]!.id).low,false);
  const result=await call("/ranking/recovery",201,admin,"POST",recovery);assert(result.created.some((r:{userId:string})=>r.userId===users[4]!.id));assert(!result.created.some((r:{userId:string})=>r.userId===users[2]!.id));
  assert(result.created.every((c:{userId:string})=>current.rows.find((r:{userId:string;low:boolean})=>r.userId===c.userId)?.low),"Solo se sortea entre quienes están en rojo");
  assert.equal((await call("/ranking/recovery",201,admin,"POST",recovery)).created.length,0);
  const taskList=await call("/work/tasks",200,tokens[4]);assert(!JSON.stringify(taskList).includes("rankingRecoveryKey"));
  const assigned=result.created.find((r:{userId:string})=>r.userId===users[4]!.id);
  await call("/work/tasks/"+assigned.taskId+"/member",200,tokens[4],"POST",{revision:1,action:"TRANSFER",targetUserId:users[1]!.id,notes:"Solicitud de reasignación que debe revisar jefatura"});
  assert(await prisma.workTaskMember.findUnique({where:{taskId_userId:{taskId:assigned.taskId,userId:users[4]!.id}}}));
  assert.equal(await prisma.workTaskMember.findUnique({where:{taskId_userId:{taskId:assigned.taskId,userId:users[1]!.id}}}),null);
  await call("/work/tasks/"+assigned.taskId+"/member",200,tokens[4],"POST",{revision:2,action:"DECLINE",notes:"Imposibilidad que no debe eximir automáticamente"});
  const due=new Date(Date.now()-86400000);await prisma.workTask.update({where:{id:assigned.taskId},data:{createdAt:new Date(Date.now()-3*86400000),dueOn:new Date(stationDate(due))}});
  const penalties=await call("/ranking?month="+stationDate(due).slice(0,7),200,admin);assert(penalties.rows.find((r:{userId:string})=>r.userId===users[4]!.id).breakdown.penalties>=defaults.missedTask);
  await prisma.workTaskMember.update({where:{taskId_userId:{taskId:assigned.taskId,userId:users[4]!.id}},data:{declinedAt:null}});
  const reclaimed=await call("/ranking?month="+stationDate().slice(0,7),200,admin);
  assert.equal(reclaimed.rows.find((r:{userId:string})=>r.userId===users[4]!.id).counters.declinedTasks,1,"Volver a tomar una tarea no borra el descuento historico de No puedo");
  const history=await call("/work/tasks/"+assigned.taskId+"/history",200,tokens[4]);assert(!JSON.stringify(history).includes("puntaje"));
  await call("/ranking/templates/"+t.id,200,admin,"PUT",{...template,revision:1,active:false});await call("/ranking/templates/"+t.id,409,admin,"PUT",{...template,revision:1});
  assert.equal(await prisma.auditLog.count({where:{action:"RANKING_RECOVERY_ASSIGNED"}}),result.created.length);
  console.log(`Ranking: ${paths} caminos HTTP aprobados; horas pagadas excluidas, intervalos sin duplicar, puntos y penalizaciones, permisos y sorteo idempotente.`);
 }finally{
  if(server)await new Promise<void>(r=>server!.close(()=>r()));if(db){const{flushRequestAudit}=await import("../middlewares/request-audit.middleware");await flushRequestAudit();}await db?.$disconnect();process.env.DATABASE_URL=original;
  if(!/^ranking_verify_[a-f0-9]{16}$/.test(schema))throw Error("Esquema inválido");await root.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);await root.$disconnect();
 }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
