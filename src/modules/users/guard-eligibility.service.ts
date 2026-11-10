import {serializable} from "../../utils/transaction";
import {guardFunctionAllowed} from "../../utils/firefighter-ranks";
import {OperationError} from "../operations/operations.schemas";
import {notify} from "../members/notifications.service";
export async function setGuardEligibility(id:string,enabled:boolean,revision:string,reason:string,actor:string){
  return serializable(async tx=>{
    const person=await tx.user.findFirst({where:{id,deletedAt:null},include:{profile:true}});
    if(!person||person.updatedAt.toISOString()!==revision)throw new OperationError(409,"El perfil cambió o no existe");
    if(enabled&&(!person.isActive||person.isPendingApproval||!guardFunctionAllowed(true,person.profile?.rank)))throw new OperationError(400,"Seleccione personal operativo activo con cargo Bombero, Oficial o Sub oficial");
    if(id===actor&&enabled)throw new OperationError(403,"Otra persona administradora debe habilitar su función de guardia");
    await tx.user.update({where:{id},data:{guardEligible:enabled}});
    if(!enabled)await tx.authSession.updateMany({where:{userId:id,guardMode:true},data:{guardMode:false}});
    await tx.auditLog.create({data:{actorUserId:actor,action:enabled?"GUARD_FUNCTION_GRANTED":"GUARD_FUNCTION_REVOKED",entityType:"User",entityId:id,metadata:{before:person.guardEligible,after:enabled,reason}}});
    await notify(tx,[id],enabled?"Función de guardia habilitada":"Función de guardia revocada","/me",reason);
    return {guardEligible:enabled};
  });
}
