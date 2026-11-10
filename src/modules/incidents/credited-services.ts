import { Prisma } from "@prisma/client";
export function creditedServices(userId:string): Prisma.ServiceParticipationWhereInput {
  return {userId,cancelledAt:null,verifiedAt:{not:null},OR:[
    {shiftId:{not:null}},
    {incident:{sheet:null}},
    {incident:{sheet:{finalizedAt:null}}},
    {incident:{sheet:{baseUserIds:{has:userId}}}},
    {incident:{movements:{some:{returnedAt:{not:null},departure:{voidedAt:null},crew:{some:{userId}}}}}},
  ]};
}
