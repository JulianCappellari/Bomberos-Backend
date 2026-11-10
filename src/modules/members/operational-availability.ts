import {prisma} from "../../config/prisma";
import {PUBLIC_USER_SELECT} from "../../utils/public-user";
import {normalizeRank} from "../../utils/firefighter-ranks";
export type OperationalStatus="PRESENT"|"AVAILABLE"|"UNAVAILABLE"|"DEPLOYED"|"UNKNOWN";
export function operationalStatus(deployed:boolean,present:boolean,unavailable:boolean,confirmed:boolean):OperationalStatus{
  return deployed?"DEPLOYED":present?"PRESENT":unavailable?"UNAVAILABLE":confirmed?"AVAILABLE":"UNKNOWN";
}
export async function operationalAvailability(){
  const now=new Date();
  const people=await prisma.user.findMany({where:{isActive:true,isPendingApproval:false,deletedAt:null},select:{
    ...PUBLIC_USER_SELECT,emergencyStatusConfirmedAt:true,
    attendances:{where:{status:"OPEN",checkInAt:{lte:now},checkInQrId:{not:null},checkInTrust:{not:"REJECTED"}},select:{id:true},take:1},
    missionCrew:{where:{movement:{returnedAt:null}},select:{userId:true},take:1},
    emergencyAvailability:{where:{cancelledAt:null,startsAt:{lte:now},OR:[{endsAt:null},{endsAt:{gt:now}}]},select:{id:true},take:1},
  },orderBy:{username:"asc"}});
  return {generatedAt:now,people:people.filter(p=>normalizeRank(p.profile?.rank)!=="administrador").map(({attendances,missionCrew,emergencyAvailability,emergencyStatusConfirmedAt,...person})=>({
    ...person,status:operationalStatus(Boolean(missionCrew.length),Boolean(attendances.length),Boolean(emergencyAvailability.length),Boolean(emergencyStatusConfirmedAt)),
  }))};
}
