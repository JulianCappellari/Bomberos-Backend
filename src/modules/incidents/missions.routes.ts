import { Request, Router } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { createHash, randomUUID } from "node:crypto";
import { prisma } from "../../config/prisma";
import { authorize } from "../../middlewares/role.middleware";
import { serializable } from "../../utils/transaction";
import { stationDate } from "../../utils/station-time";
import { PUBLIC_USER_SELECT } from "../../utils/public-user";
import { OperationError } from "../operations/operations.schemas";
import { requireQrPresence } from "../../utils/require-qr-presence";
import { normalizeRank } from "../../utils/firefighter-ranks";
import { lockRow } from "../../utils/database-schema";
import { activePeople } from "../work/work.service";
import { notify, notifyCommand } from "../members/notifications.service";
import { driverLicenseCheck, licensedDriverPairs } from "./driver-eligibility";
import { missionBriefing } from "./mission-briefing";
import { normalizeLicenseClass, VEHICLE_LICENSE_CATEGORIES, VehicleLicenseCategory } from "../../utils/license-classes";
const router = Router();
// Orden logico y sin horas futuras. La salida puede ser hasta 1 h anterior al aviso (la alerta se carga a veces despues).
function assertMovementTimes(t:{departedAt:Date;arrivedAt:Date|null;returnedAt:Date|null},occurredAt:Date){
  const now=Date.now()+60000;
  if(+t.departedAt>now||t.arrivedAt&&+t.arrivedAt>now||t.returnedAt&&+t.returnedAt>now)throw new OperationError(400,"Los horarios no pueden ser futuros");
  if(+t.departedAt<+occurredAt-3600000)throw new OperationError(400,"La salida no puede ser más de una hora anterior al aviso de la emergencia");
  if(t.arrivedAt&&t.arrivedAt<t.departedAt)throw new OperationError(400,"La llegada no puede ser anterior a la salida");
  if(t.returnedAt&&t.returnedAt<=t.departedAt)throw new OperationError(400,"El regreso debe ser posterior a la salida");
  if(t.returnedAt&&t.arrivedAt&&t.arrivedAt>t.returnedAt)throw new OperationError(400,"La llegada no puede ser posterior al regreso");
}
// Quien pasa a integrar una salida deja de figurar como personal en base en la planilla abierta.
async function dropFromBase(tx:Prisma.TransactionClient,incidentId:string,userIds:string[],actorUserId:string){
  const sheet=await tx.incidentSheet.findUnique({where:{incidentId},select:{baseUserIds:true,finalizedAt:true}});
  if(!sheet||sheet.finalizedAt)return;
  const removed=sheet.baseUserIds.filter(id=>userIds.includes(id));
  if(!removed.length)return;
  await tx.incidentSheet.update({where:{incidentId},data:{baseUserIds:sheet.baseUserIds.filter(id=>!userIds.includes(id)),revision:{increment:1}}});
  await tx.auditLog.create({data:{actorUserId,action:"INCIDENT_SHEET_BASE_ADJUSTED",entityType:"Incident",entityId:incidentId,metadata:{removedFromBase:removed,reason:"Pasaron a integrar una salida (personal actuante)"}}});
}
async function assertNoOverlap(tx:Prisma.TransactionClient,v:{assetId:string;userIds:string[];from:Date;to:Date|null;exceptId?:string}){
  const clash=await tx.missionMovement.findFirst({where:{...(v.exceptId?{id:{not:v.exceptId}}:{}),incident:{voidedAt:null},...(v.to?{departedAt:{lt:v.to}}:{}),OR:[{returnedAt:null},{returnedAt:{gt:v.from}}],AND:[{OR:[{assetId:v.assetId},{crew:{some:{userId:{in:v.userIds}}}}]}]},select:{asset:{select:{name:true}}}});
  if(clash)throw new OperationError(409,`El móvil o parte de la dotación figuran en otra salida en ese horario (${clash.asset.name})`);
}
const id = z.string().min(1).max(100);
const commandRole = (role?: string) => ["ADMIN", "OPERATOR", "GUARD"].includes(role || "");
async function requirePresentOrCommand(tx: Prisma.TransactionClient, req: Request) {
  if (!commandRole(req.user?.role)) await requireQrPresence(tx, req.user!.userId);
}
router.get("/options", async (req,res) => {
  const result = await prisma.$transaction(async tx => {
    await requirePresentOrCommand(tx, req);
    const [incidents,assets,people,authorizations] = await Promise.all([
      tx.incident.findMany({select:{id:true,title:true,status:true},orderBy:{occurredAt:"desc"},take:100}),
      tx.asset.findMany({where:{deletedAt:null,assetType:"VEHICLE"},select:{id:true,name:true,status:true,lastCheckDate:true,vehicle:{select:{licenseCategory:true}},maintenanceJobs:{where:{status:{in:["OPEN","IN_PROGRESS"]}},select:{blocksOperation:true}}},orderBy:{name:"asc"}}),
      tx.user.findMany({where:{deletedAt:null,isActive:true,isPendingApproval:false},select:PUBLIC_USER_SELECT}),
      tx.vehicleDriverAuthorization.findMany({include:{license:{select:{revision:true,deletedAt:true,issuedOn:true,expiresOn:true,licenseClasses:true}}}}),
    ]);
    const today=new Date(stationDate());
    // Conductores habilitados por su licencia segun la categoria de cada movil (sin tramite de jefatura).
    const licensed=await licensedDriverPairs(tx,today);
    return {licensed,incidents,assets:assets.map(({maintenanceJobs,vehicle,...asset})=>{const category=(vehicle?.licenseCategory||"UNSET") as VehicleLicenseCategory;const licenseRule={category,label:VEHICLE_LICENSE_CATEGORIES[category]?.label??"",required:VEHICLE_LICENSE_CATEGORIES[category]?.required??[]};const hasBlockingIssue=maintenanceJobs.some(job=>job.blocksOperation),hasNonBlockingIssue=maintenanceJobs.some(job=>!job.blocksOperation),recentCheck=Boolean(asset.lastCheckDate&&asset.lastCheckDate>=new Date(Date.now()-7*86400000));return {...asset,licenseRule,dispatchable:!hasBlockingIssue&&(asset.status==="OPERATIONAL"||asset.status==="MAINTENANCE"&&(hasNonBlockingIssue||!recentCheck)),requiresException:asset.status==="MAINTENANCE"||hasNonBlockingIssue||!recentCheck,expiredControl:!recentCheck,hasBlockingIssue};}),people,authorizations:authorizations.map(({license,...row})=>({...row,licenseCurrent:Boolean(license&&!license.deletedAt&&license.revision===row.licenseRevision&&license.issuedOn&&license.issuedOn<=today&&license.expiresOn&&license.expiresOn>=today&&license.licenseClasses.includes(row.requiredClass))}))};
  }, { isolationLevel: "RepeatableRead" });
  res.json(result);
});
router.put("/authorizations", authorize("ADMIN","OPERATOR"), async (req,res) => {
  const input=z.object({assetId:id,userId:id,requiredClass:z.string().trim().toUpperCase().regex(/^[A-Z0-9.]{1,12}$/).transform(normalizeLicenseClass),validUntil:z.string().date().optional(),reason:z.string().trim().min(10).max(1000),revision:z.number().int().min(0)}).strict().parse(req.body);
  if(input.userId===req.user!.userId) throw new OperationError(403,"Otra persona de jefatura debe habilitarlo como conductor");
  res.json(await serializable(async tx=>{
    await activePeople(tx,[input.userId]);
    if(!await tx.asset.findFirst({where:{id:input.assetId,assetType:"VEHICLE",deletedAt:null}}))throw new OperationError(400,"Movil no disponible");
    const license=await tx.personalDeclaration.findFirst({where:{userId:input.userId,category:"DRIVER_LICENSE",deletedAt:null,licenseClasses:{has:input.requiredClass},issuedOn:{lte:new Date(stationDate())},expiresOn:{gte:new Date(stationDate())}},orderBy:[{expiresOn:"desc"},{id:"asc"}]});
    if(!license)throw new OperationError(400,"Debe existir una licencia declarada, vigente y de la clase requerida");
    const old=await tx.vehicleDriverAuthorization.findUnique({where:{assetId_userId:{assetId:input.assetId,userId:input.userId}}});
    if((old?.revision||0)!==input.revision)throw new OperationError(409,"La habilitacion cambio");
    // J03: la habilitacion rige hasta el vencimiento de la licencia que la respalda.
    const {revision,validUntil:_ignored,...fields}=input, data={...fields,licenseId:license.id,licenseRevision:license.revision,validUntil:license.expiresOn!,grantedByUserId:req.user!.userId};
    const row=old?await tx.vehicleDriverAuthorization.update({where:{assetId_userId:{assetId:input.assetId,userId:input.userId}},data:{...data,revision:{increment:1}}}):await tx.vehicleDriverAuthorization.create({data});
    await tx.auditLog.create({data:{actorUserId:req.user!.userId,action:"DRIVER_AUTHORIZATION_SAVED",entityType:"Asset",entityId:input.assetId,metadata:{...input,licenseId:license.id,licenseRevision:license.revision,licenseExpiresOn:license.expiresOn!.toISOString(),nextRevision:row.revision}}});
    return row;
  }));
});
// Inicio: fallas y novedades del movil en que salio la persona (mientras no vuelva al cuartel).
router.get("/briefing", async (req,res)=>{ res.json(await missionBriefing(req.user!.userId)); });
router.get("/", async (req,res)=>{
  const {incidentId}=z.object({incidentId:id}).parse(req.query);
  const rows=await prisma.$transaction(async tx=>{
    await requirePresentOrCommand(tx,req);
    return tx.missionMovement.findMany({where:{incidentId},include:{asset:{select:{name:true,status:true}},crew:{include:{user:{select:PUBLIC_USER_SELECT}}}},orderBy:{departedAt:"desc"},take:100});
  });
  res.json(rows);
});
router.post("/authorizations/revoke",authorize("ADMIN","OPERATOR"),async(req,res)=>{
  const input=z.object({assetId:id,userId:id,revision:z.number().int().positive(),reason:z.string().trim().min(10).max(1000)}).strict().parse(req.body);
  res.json(await serializable(async tx=>{
    const old=await tx.vehicleDriverAuthorization.findUnique({where:{assetId_userId:{assetId:input.assetId,userId:input.userId}}});
    const today=new Date(stationDate());
    if(!old||old.revision!==input.revision||old.validUntil<today)throw new OperationError(409,"La habilitación cambió o ya no está vigente");
    const row=await tx.vehicleDriverAuthorization.update({where:{assetId_userId:{assetId:input.assetId,userId:input.userId}},data:{validUntil:new Date(+today-86400000),revision:{increment:1}}});
    await tx.auditLog.create({data:{actorUserId:req.user!.userId,action:"DRIVER_AUTHORIZATION_REVOKED",entityType:"Asset",entityId:input.assetId,metadata:{...input,previousValidUntil:old.validUntil.toISOString(),nextRevision:row.revision}}});
    return row;
  }));
});
router.post("/", async(req,res)=>{
  const input=z.object({incidentId:id,assetId:id,driverUserId:id,leaderUserId:id,userIds:z.array(id).min(1).max(40),dispatchExceptionReason:z.string().trim().max(1000).optional(),departedAt:z.string().datetime({offset:true}).optional(),arrivedAt:z.string().datetime({offset:true}).optional(),returnedAt:z.string().datetime({offset:true}).optional()}).strict().refine(v=>new Set(v.userIds).size===v.userIds.length&&v.userIds.includes(v.driverUserId)&&v.userIds.includes(v.leaderUserId),"Conductor y encargado deben integrar una dotacion sin repetidos").parse(req.body);
  let unauthorizedDriver=false;
  try{
  res.status(201).json(await serializable(async tx=>{
    unauthorizedDriver=false;
    await requirePresentOrCommand(tx,req);
    await lockRow(tx, "Incident", input.incidentId);
    const incident=await tx.incident.findUnique({where:{id:input.incidentId}});
    if(!incident||incident.status!=="OPEN")throw new OperationError(409,"La intervencion no esta abierta");
    // La planilla puede cargarse despues de la salida: se aceptan los horarios reales de salida, llegada y
    // regreso. Si trae el regreso, es una salida ya terminada (G15: tambien al rehacer una anulada).
    const manual=Boolean(input.departedAt||input.arrivedAt||input.returnedAt);
    const historical=Boolean(input.returnedAt);
    if(incident.replacesIncidentId&&(!input.departedAt||!input.returnedAt))throw new OperationError(400,"Al rehacer una intervención anulada cargá la salida y el retorno reales");
    const times={departedAt:input.departedAt?new Date(input.departedAt):new Date(),arrivedAt:input.arrivedAt?new Date(input.arrivedAt):null,returnedAt:input.returnedAt?new Date(input.returnedAt):null};
    assertMovementTimes(times,incident.occurredAt);
    const asset=await tx.asset.findFirst({where:{id:input.assetId,deletedAt:null,status:{in:["OPERATIONAL","MAINTENANCE"]},assetType:"VEHICLE"}});
    const blockingJob=await tx.maintenanceJob.findFirst({where:{assetId:input.assetId,blocksOperation:true,status:{in:["OPEN","IN_PROGRESS"]}}});
    const activeNonBlockingJob=asset?await tx.maintenanceJob.findFirst({where:{assetId:input.assetId,blocksOperation:false,status:{in:["OPEN","IN_PROGRESS"]}}}):null;
    if(!asset||blockingJob)throw new OperationError(409,"El movil no debe tener una falla bloqueante ni estar fuera de servicio");
    const expiredControl=!asset.lastCheckDate||asset.lastCheckDate < new Date(Date.now()-7*86400000);
    const requiresException=asset.status==="MAINTENANCE"||Boolean(activeNonBlockingJob)||expiredControl;
    if(asset.status==="MAINTENANCE"&&!activeNonBlockingJob&&!expiredControl)throw new OperationError(409,"No hay una falla vigente documentada como no bloqueante");
    if(requiresException&&(!input.dispatchExceptionReason||input.dispatchExceptionReason.length<10))throw new OperationError(409,expiredControl?"El control semanal está vencido: la salida requiere una justificación que se informa a jefatura":"La falla no bloqueante debe justificarse y quedar documentada antes del despacho");
    if(!requiresException&&input.dispatchExceptionReason)throw new OperationError(400,"La justificación excepcional solo aplica a móviles con fallas no bloqueantes o control vencido");
    await activePeople(tx,input.userIds);
    // Ni el movil ni el personal pueden estar en dos salidas que se superpongan en el tiempo.
    await assertNoOverlap(tx,{assetId:input.assetId,userIds:input.userIds,from:times.departedAt,to:times.returnedAt});
    const today=new Date(stationDate());
    // Movil con categoria de licencia: alcanza con una licencia vigente que cubra las clases exigidas.
    // Movil sin configurar: rige la habilitacion manual de jefatura respaldada por la licencia.
    const byLicense=await driverLicenseCheck(tx,input.assetId,input.driverUserId,today);
    let driverProof:{via:string;requiredClass:string;licenseId:string;licenseRevision:number;validUntil:string|null;authorizationRevision:number|null};
    if(byLicense.configured){
      if(!byLicense.eligible||!byLicense.licenseId){unauthorizedDriver=true;throw new OperationError(403,`El conductor no tiene licencia vigente para este móvil: le falta ${byLicense.missing.join(" y ")}. Exige ${byLicense.required.join(" + ")}`);}
      driverProof={via:"LICENSE",requiredClass:byLicense.required.join("+"),licenseId:byLicense.licenseId,licenseRevision:byLicense.licenseRevision!,validUntil:null,authorizationRevision:null};
    }else{
      const permit=await tx.vehicleDriverAuthorization.findUnique({where:{assetId_userId:{assetId:input.assetId,userId:input.driverUserId}}});
      const license=permit?.licenseId?await tx.personalDeclaration.findFirst({where:{id:permit.licenseId,revision:permit.licenseRevision??-1,userId:input.driverUserId,category:"DRIVER_LICENSE",deletedAt:null,licenseClasses:{has:permit.requiredClass},issuedOn:{lte:today},expiresOn:{gte:today}}}):null;
      if(!permit||permit.validUntil<today||!license){unauthorizedDriver=true;throw new OperationError(403,"El conductor necesita habilitación y la misma versión vigente de licencia revisada por jefatura; si cambió debe revalidarse. También podés configurar qué licencia exige el móvil para que se habilite solo");}
      driverProof={via:"AUTHORIZATION",requiredClass:permit.requiredClass,licenseId:license.id,licenseRevision:license.revision,validUntil:permit.validUntil.toISOString(),authorizationRevision:permit.revision};
    }
    const row=await tx.missionMovement.create({data:{incidentId:input.incidentId,assetId:input.assetId,driverUserId:input.driverUserId,leaderUserId:input.leaderUserId,createdByUserId:req.user!.userId,dispatchExceptionReason:requiresException?input.dispatchExceptionReason:null,departedAt:times.departedAt,arrivedAt:times.arrivedAt,crew:{create:input.userIds.map(userId=>({userId}))}}});
    if(historical){
      const departure=await tx.vehicleDeparture.create({data:{operationKey:randomUUID(),requestHash:createHash("sha256").update(row.id).digest("hex"),assetId:input.assetId,departedAt:times.departedAt,returnedAt:times.returnedAt!,purpose:incident.title.slice(0,200),notes:(incident.replacesIncidentId?"Salida recargada al rehacer la intervencion ":"Salida cargada en la planilla despues del regreso, intervencion ")+incident.id,createdByUserId:req.user!.userId,crew:{create:input.userIds.map(userId=>({userId,isLeader:userId===input.leaderUserId}))}}});
      await tx.missionMovement.update({where:{id:row.id},data:{returnedAt:times.returnedAt,departureId:departure.id,returnWithoutArrivalReason:times.arrivedAt?null:""}});
      await tx.incidentVehicle.upsert({where:{incidentId_assetId:{incidentId:input.incidentId,assetId:input.assetId}},create:{incidentId:input.incidentId,assetId:input.assetId},update:{}});
      for(const userId of input.userIds)await tx.incidentAssignment.upsert({where:{incidentId_userId:{incidentId:input.incidentId,userId}},create:{incidentId:input.incidentId,userId},update:{}});
      await dropFromBase(tx,input.incidentId,input.userIds,req.user!.userId);
      await tx.auditLog.create({data:{actorUserId:req.user!.userId,action:incident.replacesIncidentId?"MISSION_RELOADED_FOR_REDO":"MISSION_LOADED_LATE",entityType:"MissionMovement",entityId:row.id,metadata:{...input,driverProof}}});
      return row;
    }
    await tx.attendance.updateMany({where:{userId:{in:input.userIds},status:"OPEN",promptShownAt:{not:null}},data:{promptShownAt:null,promptDueAt:null}});
    await tx.incidentVehicle.upsert({where:{incidentId_assetId:{incidentId:input.incidentId,assetId:input.assetId}},create:{incidentId:input.incidentId,assetId:input.assetId},update:{}});
    for(const userId of input.userIds)await tx.incidentAssignment.upsert({where:{incidentId_userId:{incidentId:input.incidentId,userId}},create:{incidentId:input.incidentId,userId},update:{}});
    await dropFromBase(tx,input.incidentId,input.userIds,req.user!.userId);
    await tx.auditLog.create({data:{actorUserId:req.user!.userId,action:requiresException?"MISSION_DEPARTED_EXCEPTION":"MISSION_DEPARTED",entityType:"MissionMovement",entityId:row.id,metadata:{...input,driverProof,manualTimes:manual,recordedAt:new Date().toISOString()}}});
    await notify(tx,input.userIds,"Salida a intervencion registrada","/incidents","La verificacion de presencia queda suspendida hasta el retorno registrado.");
    if(requiresException&&input.dispatchExceptionReason){
      await tx.incidentNotebookEntry.create({data:{incidentId:input.incidentId,authorUserId:req.user!.userId,category:"VEHICLE",title:`Salida excepcional: ${asset.name}`,body:`${expiredControl?"El móvil salió con el control semanal vencido.":"El móvil salió con una falla no bloqueante."} Motivo y constancia: ${input.dispatchExceptionReason}`,occurredAt:new Date()}});
      const commandUsers=await tx.user.findMany({where:{isActive:true,isPendingApproval:false,deletedAt:null},select:{id:true,profile:{select:{rank:true}}}});
      const officerIds=commandUsers.filter(user=>["oficial","suboficial"].includes(normalizeRank(user.profile?.rank))).map(user=>user.id);
      await notify(tx,officerIds,`Salida excepcional de ${asset.name}`,"/incidents",input.dispatchExceptionReason);
    }
    return row;
  }));
  }catch(error){
    // F13: el intento de despacho con un conductor no habilitado se informa a jefatura aunque la salida se rechace.
    if(unauthorizedDriver)await prisma.$transaction(async tx=>{
      await tx.auditLog.create({data:{actorUserId:req.user!.userId,action:"MISSION_DRIVER_NOT_AUTHORIZED",entityType:"Asset",entityId:input.assetId,metadata:{incidentId:input.incidentId,driverUserId:input.driverUserId}}});
      await notifyCommand(tx,"Intento de salida con conductor no habilitado","/incidents/logistics","Se rechazó un despacho porque el conductor seleccionado no tiene habilitación o licencia vigente.",req.user!.userId);
    }).catch(()=>undefined);
    throw error;
  }
});
router.patch("/:id/crew",async(req,res)=>{
  const input=z.object({userIds:z.array(id).min(1).max(40),driverUserId:id,leaderUserId:id,reason:z.string().trim().min(5,"Indicá el motivo de la corrección").max(500)}).strict()
    .refine(v=>new Set(v.userIds).size===v.userIds.length&&v.userIds.includes(v.driverUserId)&&v.userIds.includes(v.leaderUserId),"Conductor y encargado deben integrar la dotación, sin repetidos").parse(req.body);
  res.json(await serializable(async tx=>{
    await requirePresentOrCommand(tx,req);
    const row=await tx.missionMovement.findUnique({where:{id:String(req.params.id)},include:{crew:true,incident:true}});
    if(!row)throw new OperationError(404,"Salida no encontrada");
    await lockRow(tx,"Incident",row.incidentId);
    if(row.incident.status!=="OPEN")throw new OperationError(409,"La intervención está cerrada: la dotación se corrige con una enmienda de jefatura");
    await activePeople(tx,input.userIds);
    const before=row.crew.map(c=>c.userId), added=input.userIds.filter(u=>!before.includes(u)), removed=before.filter(u=>!input.userIds.includes(u));
    if(added.length)await assertNoOverlap(tx,{assetId:"-",userIds:added,from:row.departedAt,to:row.returnedAt,exceptId:row.id});
    if(input.driverUserId!==row.driverUserId){
      const today=new Date(stationDate());
      const byLicense=await driverLicenseCheck(tx,row.assetId,input.driverUserId,today);
      if(byLicense.configured&&!byLicense.eligible)throw new OperationError(403,`El conductor no tiene licencia vigente para este móvil: le falta ${byLicense.missing.join(" y ")}`);
      if(!byLicense.configured){
        const permit=await tx.vehicleDriverAuthorization.findUnique({where:{assetId_userId:{assetId:row.assetId,userId:input.driverUserId}}});
        if(!permit||permit.validUntil<today)throw new OperationError(403,"El conductor necesita habilitación de jefatura para este móvil");
      }
    }
    if(removed.length)await tx.missionCrew.deleteMany({where:{movementId:row.id,userId:{in:removed}}});
    if(added.length)await tx.missionCrew.createMany({data:added.map(userId=>({movementId:row.id,userId}))});
    await tx.missionMovement.update({where:{id:row.id},data:{driverUserId:input.driverUserId,leaderUserId:input.leaderUserId}});
    if(row.departureId){
      if(removed.length)await tx.departureMember.deleteMany({where:{departureId:row.departureId,userId:{in:removed}}});
      if(added.length)await tx.departureMember.createMany({data:added.map(userId=>({departureId:row.departureId!,userId}))});
      await tx.departureMember.updateMany({where:{departureId:row.departureId},data:{isLeader:false}});
      await tx.departureMember.updateMany({where:{departureId:row.departureId,userId:input.leaderUserId},data:{isLeader:true}});
    }
    for(const userId of added)await tx.incidentAssignment.upsert({where:{incidentId_userId:{incidentId:row.incidentId,userId}},create:{incidentId:row.incidentId,userId},update:{}});
    // Quien deja de integrar la dotacion (y no esta en otra salida de la intervencion) deja de figurar asignado.
    for(const userId of removed)if(!await tx.missionCrew.findFirst({where:{userId,movement:{incidentId:row.incidentId}}}))await tx.incidentAssignment.deleteMany({where:{incidentId:row.incidentId,userId}});
    await dropFromBase(tx,row.incidentId,added,req.user!.userId);
    await tx.auditLog.create({data:{actorUserId:req.user!.userId,action:"MISSION_CREW_CORRECTED",entityType:"MissionMovement",entityId:row.id,metadata:{reason:input.reason,before:{crew:before,driverUserId:row.driverUserId,leaderUserId:row.leaderUserId},after:{crew:input.userIds,driverUserId:input.driverUserId,leaderUserId:input.leaderUserId}}}});
    return {id:row.id,added,removed};
  }));
});
router.patch("/:id/times",async(req,res)=>{
  const input=z.object({departedAt:z.string().datetime({offset:true}).optional(),arrivedAt:z.string().datetime({offset:true}).nullable().optional(),returnedAt:z.string().datetime({offset:true}).optional(),reason:z.string().trim().min(5,"Indicá el motivo de la corrección").max(500)}).strict().parse(req.body);
  res.json(await serializable(async tx=>{
    await requirePresentOrCommand(tx,req);
    const row=await tx.missionMovement.findUnique({where:{id:String(req.params.id)},include:{crew:true,incident:true}});
    if(!row)throw new OperationError(404,"Salida no encontrada");
    await lockRow(tx,"Incident",row.incidentId);
    if(row.incident.status!=="OPEN")throw new OperationError(409,"La intervención está cerrada: los horarios se corrigen con una enmienda de jefatura");
    if(input.returnedAt&&!row.returnedAt)throw new OperationError(400,"Para cargar el regreso usá «Registrar retorno al cuartel»");
    const times={departedAt:input.departedAt?new Date(input.departedAt):row.departedAt,arrivedAt:input.arrivedAt===undefined?row.arrivedAt:input.arrivedAt?new Date(input.arrivedAt):null,returnedAt:input.returnedAt?new Date(input.returnedAt):row.returnedAt};
    if(row.returnWithoutArrivalReason!==null&&times.arrivedAt)throw new OperationError(400,"Esta salida regresó sin llegar al lugar");
    assertMovementTimes(times,row.incident.occurredAt);
    await assertNoOverlap(tx,{assetId:row.assetId,userIds:row.crew.map(m=>m.userId),from:times.departedAt,to:times.returnedAt,exceptId:row.id});
    const updated=await tx.missionMovement.update({where:{id:row.id},data:times});
    if(row.departureId)await tx.vehicleDeparture.update({where:{id:row.departureId},data:{departedAt:times.departedAt,...(times.returnedAt?{returnedAt:times.returnedAt}:{})}});
    await tx.auditLog.create({data:{actorUserId:req.user!.userId,action:"MISSION_TIMES_CORRECTED",entityType:"MissionMovement",entityId:row.id,metadata:{reason:input.reason,before:{departedAt:row.departedAt,arrivedAt:row.arrivedAt,returnedAt:row.returnedAt},after:times}}});
    return updated;
  }));
});
router.post("/:id/:action",async(req,res)=>{
  const {action}=z.object({action:z.enum(["arrive","return","return-without-arrival"])}).parse(req.params);
  const withoutArrival = action==="return-without-arrival";
  // "at": hora real de la llegada o el regreso (si se registra despues); sin "at" es la hora actual.
  const body=z.object({reason:z.string().trim().max(1000).optional(),at:z.string().datetime({offset:true}).optional()}).strict().parse(req.body||{});
  const reason = withoutArrival ? body.reason || "" : null;
  res.json(await serializable(async tx=>{
    await requirePresentOrCommand(tx,req);
    const row=await tx.missionMovement.findUnique({where:{id:String(req.params.id)},include:{crew:true,incident:true}});
    if(!row)throw new OperationError(404,"Salida no encontrada");
    const now=new Date();
    if(action==="arrive"&&row.arrivedAt)return {id:row.id,replayed:true};
    if(row.returnedAt){
      if(action==="return"&&row.arrivedAt||withoutArrival&&!row.arrivedAt)return {id:row.id,replayed:true};
      throw new OperationError(409,"La salida ya terminó con otro movimiento");
    }
    if(withoutArrival&&row.arrivedAt)throw new OperationError(409,"La llegada ya fue registrada; use retorno normal");
    if(action==="return"&&!row.arrivedAt)throw new OperationError(409,"Registre la llegada al lugar antes del retorno");
    const when=body.at?new Date(body.at):now;
    if(when>new Date(now.getTime()+60000))throw new OperationError(400,"La hora no puede ser futura");
    const previous=action==="return"?row.arrivedAt!:row.departedAt;
    if(when<previous)throw new OperationError(400,action==="arrive"?"La llegada no puede ser anterior a la salida":"El regreso no puede ser anterior a la llegada");
    if(action!=="arrive")await assertNoOverlap(tx,{assetId:row.assetId,userIds:row.crew.map(m=>m.userId),from:row.departedAt,to:when,exceptId:row.id});
    if(action==="arrive")await tx.missionMovement.update({where:{id:row.id},data:{arrivedAt:when}});
    else{
      const departure=await tx.vehicleDeparture.create({data:{operationKey:randomUUID(),requestHash:createHash("sha256").update(row.id).digest("hex"),assetId:row.assetId,departedAt:row.departedAt,returnedAt:when,purpose:row.incident.title.slice(0,200),notes:"Salida acreditada desde el seguimiento de la intervencion "+row.incidentId,createdByUserId:req.user!.userId,crew:{create:row.crew.map(m=>({userId:m.userId,isLeader:m.userId===row.leaderUserId}))}}});
      await tx.missionMovement.update({where:{id:row.id},data:{returnedAt:when,departureId:departure.id,returnWithoutArrivalReason:reason}});
      await tx.attendance.updateMany({where:{userId:{in:row.crew.map(m=>m.userId)},status:"OPEN",checkInQrId:{not:null}},data:{presenceResumeAt:when>now?now:when}});
    }
    await tx.auditLog.create({data:{actorUserId:req.user!.userId,action:action==="arrive"?"MISSION_ARRIVED":withoutArrival?"MISSION_RETURNED_WITHOUT_ARRIVAL":"MISSION_RETURNED",entityType:"MissionMovement",entityId:row.id,metadata:{reason,at:when.toISOString(),manualTime:Boolean(body.at),recordedAt:now.toISOString()}}});
    return {id:row.id};
  }));
});
export default router;
