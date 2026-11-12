import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../config/prisma";
import { PUBLIC_USER_SELECT } from "../../utils/public-user";
import { serializable } from "../../utils/transaction";
import { isOperationsManager, OperationError } from "../operations/operations.schemas";
import { notify } from "../members/notifications.service";
import { requireQrPresence } from "../../utils/require-qr-presence";
import { sanitizeTaskPhotos } from "./work-photos";
import { normalizeRank } from "../../utils/firefighter-ranks";
import { stationDate } from "../../utils/station-time";
import { transferResponseSchema, workState } from "./work.schemas";
import { Actor, assertPast, assertWorkTransition, assignWorkSchema, planWorkSchema, createWorkSchema, memberWorkSchema, reviewWorkSchema, selfWorkSchema, submitWorkSchema, workQuery } from "./work.schemas";
import { assertNotRestricted } from "../sanctions/sanctions";

const include = { maintenanceJob: { select: { responsibleUserId: true } }, photos: { select: { id: true, submissionRevision: true, createdAt: true }, orderBy: { createdAt: "desc" as const }, take: 30 }, createdBy: { select: PUBLIC_USER_SELECT }, reviewedBy: { select: PUBLIC_USER_SELECT }, members: { include: { user: { select: PUBLIC_USER_SELECT } }, orderBy: { userId: "asc" as const } } };
export async function activePeople(tx: Prisma.TransactionClient, ids: string[]) {
  if (new Set(ids).size !== ids.length || await tx.user.count({ where: { id: { in: ids }, isActive: true, isPendingApproval: false, deletedAt: null } }) !== ids.length) throw new OperationError(400, "Seleccione personal activo y no repetido");
  // B01: el administrador tecnico administra el sistema; nunca integra tareas, dotaciones ni servicios.
  if (await tx.user.count({ where: { id: { in: ids }, profile: { rank: { equals: "Administrador", mode: "insensitive" } } } })) throw new OperationError(400, "El administrador del sistema no realiza tareas ni integra dotaciones; solo las administra");
  await assertNotRestricted(tx, ids, "SUSPENDED", "no puede integrar dotaciones ni tareas mientras dure la suspensión");
}
function scope(actor: Actor): Prisma.WorkTaskWhereInput {
  return isOperationsManager(actor.role) ? {} : { OR: [{ status: { in: ["ASSIGNED", "RETURNED"] } }, { status: "SUBMITTED", members: { some: { userId: actor.userId } } }] };
}
export async function claimWork(id: string, revision: number, actor: Actor) {
  return serializable(async (tx) => {
    const task = await tx.workTask.findUnique({ where: { id }, include: { members: true } });
    if (!task || !["ASSIGNED", "RETURNED"].includes(task.status)) throw new OperationError(409, "La tarea ya no esta disponible para tomar");
    if (task.requiresPresence) await requireQrPresence(tx, actor.userId);
    if (task.maintenanceJobId && !await tx.maintenanceJob.findFirst({ where: { id: task.maintenanceJobId, status: { in: ["OPEN", "IN_PROGRESS"] } }, select: { id: true } })) throw new OperationError(409, "El mantenimiento ya esta cerrado");
    if (task.members.some((m) => m.userId === actor.userId && !m.declinedAt)) return { message: "Ya integra el equipo" };
    await activePeople(tx, [actor.userId]);
    if (task.members.filter((m) => !m.declinedAt).length >= 30) throw new OperationError(409, "El equipo alcanzo su limite");
    if (!(await tx.workTask.updateMany({ where: { id, revision, status: task.status }, data: { revision: { increment: 1 } } })).count) throw new OperationError(409, "La tarea cambio; recargue antes de tomarla");
    await tx.workTaskMember.upsert({ where: { taskId_userId: { taskId: id, userId: actor.userId } }, create: { taskId: id, userId: actor.userId }, update: { declinedAt: null } });
    await event(tx, id, actor, "CLAIMED", "Se incorporo al equipo para realizar la tarea");
    return { message: "Quedo registrado que realizara esta tarea" };
  });
}
async function event(tx: Prisma.TransactionClient, taskId: string, actor: Actor, action: string, notes: string) {
  await tx.workTaskEvent.create({ data: { taskId, actorUserId: actor.userId, action, notes } });
  const members = await tx.workTaskMember.findMany({ where: { taskId }, select: { userId: true } });
  const managers = ["REPORTED", "SUBMITTED", "DECLINE"].includes(action) ? await tx.user.findMany({ where: { isActive: true, deletedAt: null, isPendingApproval: false, OR: [{ role: { in: ["ADMIN", "OPERATOR"] } }, { profile: { rank: { in: ["Oficial", "Sub oficial", "Administrador"] } } }] }, select: { id: true } }) : [];
  const task = await tx.workTask.findUniqueOrThrow({ where: { id: taskId }, select: { title: true, createdByUserId: true } });
  const labels: Record<string, string> = { CREATED: "Tarea asignada", REPORTED: "Trabajo para verificar", SUBMITTED: "Tarea para verificar", VERIFIED: "Trabajo verificado", RETURNED: "Tarea devuelta", CANCELLED: "Tarea cancelada", TRANSFER: "Tarea transferida", DECLINE: "Imposibilidad informada", REASSIGNED: "Equipo reasignado" };
  await notify(tx, [task.createdByUserId, ...members.map((m) => m.userId), ...managers.map((m) => m.id)].filter((id) => id !== actor.userId), `${labels[action] || "Novedad en tarea"}: ${task.title}`, "/tasks", ["VERIFIED", "RETURNED", "CANCELLED"].includes(action) ? notes : undefined);
  await tx.auditLog.create({ data: { actorUserId: actor.userId, action: `WORK_${action}`, entityType: "WorkTask", entityId: taskId } });
}
export async function listWork(query: z.infer<typeof workQuery>, actor: Actor) {
  const where: Prisma.WorkTaskWhereInput = { AND: [scope(actor), ...(query.q ? [{ OR: ["title", "description"].map((key) => ({ [key]: { contains: query.q, mode: "insensitive" as const } })) }] : [])], ...(query.mine === "true" ? { members: { some: { userId: actor.userId } } } : {}), ...(query.status ? { status: query.status } : {}) };
  if (query.pending === "true") where.status = { in: ["ASSIGNED", "SUBMITTED", "RETURNED"] };
  const [items, total] = await prisma.$transaction([
    prisma.workTask.findMany({ where, include: { ...include, events: { where: { action: "CLAIMED" }, select: { id: true }, take: 1 }, transfers: { where: { status: "PENDING" }, select: { id: true, fromUserId: true, toUserId: true, notes: true, createdAt: true } } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (query.page - 1) * 30, take: 30 }), prisma.workTask.count({ where }),
  ], { isolationLevel: "RepeatableRead" });
  const today = stationDate();
  return { items: items.map(({ events, ...task }) => ({ ...task, state: workState({ status: task.status, dueOn: task.dueOn, activeMembers: task.members.filter((m) => !m.declinedAt).length, claimed: events.length > 0 }, today) })), total, page: query.page, pageSize: 30 };
}
export async function workHistory(id: string, actor: Actor) {
  const task = await prisma.workTask.findFirst({ where: { id, ...scope(actor) }, select: { id: true } });
  if (!task) throw new OperationError(404, "Tarea no encontrada");
  return prisma.workTaskEvent.findMany({ where: { taskId: id }, include: { actor: { select: PUBLIC_USER_SELECT } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 100 });
}
export async function createWork(input: z.infer<typeof createWorkSchema> | z.infer<typeof selfWorkSchema>, actor: Actor, self = false) {
  if (!self && !isOperationsManager(actor.role) && input.userIds.length) throw new OperationError(403, "Puede publicar una tarea abierta, pero solo jefatura puede asignar personas");
  if (self && !input.userIds.includes(actor.userId)) throw new OperationError(400, "Incluyase entre quienes realizaron el trabajo");
  const submission = self ? selfWorkSchema.parse(input) : null;
  const completedAt = submission ? assertPast(submission.completedAt) : null;
  const photos = submission ? await sanitizeTaskPhotos(submission.photos) : [];
  return serializable(async (tx) => {
    if (self) await requireQrPresence(tx, actor.userId);
    await activePeople(tx, input.userIds);
    const task = await tx.workTask.create({ data: {
      title: input.title, description: input.description, dueOn: "dueOn" in input && input.dueOn ? new Date(input.dueOn) : null,
      isSelfReported: self, status: self ? "SUBMITTED" : "ASSIGNED", createdByUserId: actor.userId, requiresPresence: "requiresPresence" in input ? input.requiresPresence : true,
      completionNotes: submission?.notes, completedAt, evidenceUrls: submission?.evidenceUrls,
      members: { create: input.userIds.map((userId) => ({ userId })) },
      photos: { create: photos.map((photo) => ({ ...photo, submissionRevision: 1 })) },
    }, include });
    await event(tx, task.id, actor, self ? "REPORTED" : "CREATED", input.description);
    if (!self && !input.userIds.length) {
      const people = await tx.user.findMany({ where: { isActive: true, isPendingApproval: false, deletedAt: null, id: { not: actor.userId } }, select: { id: true } });
      await notify(tx, people.map((person) => person.id), `Trabajo disponible: ${task.title}`, "/tasks", task.description);
    }
    return task;
  });
}
export async function submitWork(id: string, input: z.infer<typeof submitWorkSchema>, actor: Actor) {
  const completedAt = assertPast(input.completedAt);
  const photos = await sanitizeTaskPhotos(input.photos);
  return serializable(async (tx) => {
    const task = await tx.workTask.findFirst({ where: { id, members: { some: { userId: actor.userId, declinedAt: null } } } });
    if (!task) throw new OperationError(404, "Tarea asignada no encontrada");
    if (task.requiresPresence) await requireQrPresence(tx, actor.userId);
    const repair = await tx.inspection.findUnique({ where: { repairTaskId: id }, select: { id: true } });
    // K03: puede completarse sin fotografia si se aporta otra evidencia suficiente.
    if (repair && !photos.length && !input.evidenceUrls.length) throw new OperationError(400, "Adjunte una foto u otra evidencia de la correccion del control vehicular");
    if (!task.isSelfReported && completedAt < task.createdAt) throw new OperationError(400, "La realizacion no puede ser anterior a la asignacion");
    assertWorkTransition(task.status, "SUBMITTED");
    const changed = await tx.workTask.updateMany({ where: { id, revision: input.revision, status: task.status }, data: { status: "SUBMITTED", completionNotes: input.notes, completedAt, evidenceUrls: input.evidenceUrls, reviewedAt: null, reviewedByUserId: null, reviewNotes: null, revision: { increment: 1 } } });
    if (!changed.count) throw new OperationError(409, "La tarea cambio. Actualice antes de enviar");
    if (photos.length) await tx.workPhoto.createMany({ data: photos.map((photo) => ({ ...photo, taskId: id, submissionRevision: input.revision + 1 })) });
    await event(tx, id, actor, "SUBMITTED", input.notes);
    return tx.workTask.findUniqueOrThrow({ where: { id }, include });
  });
}

export async function taskPhoto(taskId: string, photoId: string, actor: Actor) {
  const photo = await prisma.workPhoto.findFirst({ where: { id: photoId, taskId, task: scope(actor) }, select: { bytes: true } });
  if (!photo) throw new OperationError(404, "Evidencia no encontrada");
  return photo.bytes;
}
export async function reviewWork(id: string, input: z.infer<typeof reviewWorkSchema>, actor: Actor) {
  if (!isOperationsManager(actor.role)) throw new OperationError(403, "Solo responsables pueden verificar");
  return serializable(async (tx) => {
    const task = await tx.workTask.findUnique({ where: { id }, include: { members: true } });
    if (!task) throw new OperationError(404, "Tarea no encontrada");
    if(input.status==="VERIFIED"){
      const reviewer=await tx.user.findUnique({where:{id:actor.userId},select:{profile:{select:{rank:true}}}});
      // K04: la ultima palabra al avalar la tiene un oficial o un suboficial.
      if(!["oficial","suboficial"].includes(normalizeRank(reviewer?.profile?.rank).replace(/\s/g,"")))throw new OperationError(403,"Solo un oficial o suboficial puede avalar una tarea como realizada");
      if(!task.completedAt)throw new OperationError(409,"La tarea no tiene fecha de realización");
      if(!task.members.some(m=>!m.declinedAt))throw new OperationError(409,"No puede avalar una tarea sin integrantes responsables");
      for(const member of task.requiresPresence?task.members.filter(m=>!m.declinedAt):[]){
        const at=task.completedAt;
        const present=await tx.attendance.findFirst({where:{userId:member.userId,checkInQrId:{not:null},checkInAt:{lte:at},checkInTrust:{not:"REJECTED"},OR:[{status:"OPEN"},{checkOutAt:{gte:at},checkOutTrust:{not:"REJECTED"}}]},select:{id:true}});
        const deployed=await tx.missionCrew.findFirst({where:{userId:member.userId,movement:{departedAt:{lte:at},OR:[{returnedAt:null},{returnedAt:{gt:at}}]}},select:{userId:true}});
        if(!present||deployed)throw new OperationError(409,"No se puede avalar: hay integrantes sin presencia QR válida en la fecha de realización o que estaban desplegados");
      }
    }
    if (input.status !== "CANCELLED" && (task.createdByUserId === actor.userId && task.isSelfReported || task.members.some((m) => m.userId === actor.userId))) throw new OperationError(403, "Otro responsable debe verificar el trabajo propio");
    if(!(task.status==="VERIFIED"&&!task.officerApproved&&input.status==="VERIFIED"))assertWorkTransition(task.status, input.status);
    const changed = await tx.workTask.updateMany({ where: { id, revision: input.revision, status: task.status }, data: { status: input.status, officerApproved:input.status==="VERIFIED", reviewedAt: new Date(), reviewedByUserId: actor.userId, reviewNotes: input.notes, revision: { increment: 1 } } });
    if (!changed.count) throw new OperationError(409, "La tarea cambio. Actualice antes de revisar");
    await event(tx, id, actor, input.status, input.notes);
    return tx.workTask.findUniqueOrThrow({ where: { id }, include });
  });
}
export async function changeWorkMember(id: string, input: z.infer<typeof memberWorkSchema>, actor: Actor) {
  return serializable(async (tx) => {
    const task = await tx.workTask.findFirst({ where: { id, members: { some: { userId: actor.userId, declinedAt: null } } }, include: { members: true } });
    if (!task) throw new OperationError(404, "Tarea asignada no encontrada");
    if (!["ASSIGNED", "RETURNED"].includes(task.status)) throw new OperationError(409, "Solo puede transferir o rechazar tareas pendientes");
    if (input.action === "TRANSFER") {
      if (input.targetUserId === actor.userId || task.members.some((m) => m.userId === input.targetUserId && !m.declinedAt)) throw new OperationError(400, "La persona ya integra la tarea");
      await activePeople(tx, [input.targetUserId!]);
      if (await tx.workTaskTransfer.findFirst({ where: { taskId: id, fromUserId: actor.userId, status: "PENDING" } })) throw new OperationError(409, "Ya tiene una transferencia pendiente de respuesta para esta tarea");
    }
    const changed = await tx.workTask.updateMany({ where: { id, revision: input.revision }, data: { revision: { increment: 1 } } });
    if (!changed.count) throw new OperationError(409, "La tarea cambio. Actualice antes de continuar");
    if (input.action === "TRANSFER") {
      // K07: la tarea queda transferida cuando la persona de destino acepta.
      await tx.workTaskTransfer.create({ data: { taskId: id, fromUserId: actor.userId, toUserId: input.targetUserId!, notes: input.notes.slice(0, 1000) } });
      await event(tx, id, actor, "TRANSFER_REQUESTED", input.notes);
      await notify(tx, [input.targetUserId!], `Le proponen transferirle una tarea: ${task.title}`, "/tasks", input.notes);
      return { message: "Transferencia propuesta. Sigue asignado hasta que la persona de destino acepte" };
    }
    // K06: "No puedo" libera la tarea para que otra persona la tome, descuenta puntos y avisa a jefatura.
    await tx.workTaskMember.update({ where: { taskId_userId: { taskId: id, userId: actor.userId } }, data: { declinedAt: new Date() } });
    await tx.workTaskTransfer.updateMany({ where: { taskId: id, fromUserId: actor.userId, status: "PENDING" }, data: { status: "CANCELLED", resolvedAt: new Date() } });
    await event(tx, id, actor, "DECLINE", input.notes);
    const remaining = task.members.filter((m) => m.userId !== actor.userId && !m.declinedAt).length;
    if (!remaining) {
      const people = await tx.user.findMany({ where: { isActive: true, isPendingApproval: false, deletedAt: null, id: { not: actor.userId } }, select: { id: true } });
      await notify(tx, people.map((person) => person.id), `Trabajo disponible nuevamente: ${task.title}`, "/tasks", task.description);
    }
    return { message: remaining ? "Imposibilidad registrada: el resto del equipo conserva la tarea. Se aplica el descuento de puntos y se avisó a jefatura" : "Imposibilidad registrada: la tarea volvió a quedar disponible para que otra persona la tome. Se aplica el descuento de puntos y se avisó a jefatura" };
  });
}
export async function pendingTransfers(actor: Actor) {
  return prisma.workTaskTransfer.findMany({ where: { status: "PENDING", OR: [{ toUserId: actor.userId }, { fromUserId: actor.userId }] }, include: { task: { select: { id: true, title: true, description: true, dueOn: true, status: true } }, from: { select: PUBLIC_USER_SELECT }, to: { select: PUBLIC_USER_SELECT } }, orderBy: [{ createdAt: "desc" }, { id: "asc" }], take: 100 });
}
export async function respondTransfer(transferId: string, input: z.infer<typeof transferResponseSchema>, actor: Actor) {
  return serializable(async (tx) => {
    const transfer = await tx.workTaskTransfer.findUnique({ where: { id: transferId }, include: { task: { include: { members: true } } } });
    if (!transfer || transfer.status !== "PENDING") throw new OperationError(409, "La transferencia ya fue respondida o cancelada");
    const own = transfer.fromUserId === actor.userId;
    if (!own && transfer.toUserId !== actor.userId) throw new OperationError(403, "Solo la persona de destino responde la transferencia");
    if (own && input.accept) throw new OperationError(403, "Quien transfiere solo puede cancelar su propuesta");
    const resolvedAt = new Date();
    if (!input.accept) {
      await tx.workTaskTransfer.update({ where: { id: transferId }, data: { status: own ? "CANCELLED" : "REJECTED", resolvedAt } });
      await event(tx, transfer.taskId, actor, own ? "TRANSFER_CANCELLED" : "TRANSFER_REJECTED", input.notes || "Sin observaciones");
      if (!own) await notify(tx, [transfer.fromUserId], `Transferencia rechazada: ${transfer.task.title}`, "/tasks", input.notes || undefined);
      return { message: own ? "Propuesta cancelada" : "Transferencia rechazada; la tarea sigue con su responsable original" };
    }
    if (!["ASSIGNED", "RETURNED"].includes(transfer.task.status) || !transfer.task.members.some((m) => m.userId === transfer.fromUserId && !m.declinedAt)) {
      await tx.workTaskTransfer.update({ where: { id: transferId }, data: { status: "CANCELLED", resolvedAt } });
      return { message: "La tarea cambió y la transferencia quedó sin efecto" };
    }
    await activePeople(tx, [actor.userId]);
    if (transfer.task.requiresPresence) await requireQrPresence(tx, actor.userId);
    await tx.workTask.update({ where: { id: transfer.taskId }, data: { revision: { increment: 1 } } });
    await tx.workTaskMember.delete({ where: { taskId_userId: { taskId: transfer.taskId, userId: transfer.fromUserId } } });
    await tx.workTaskMember.upsert({ where: { taskId_userId: { taskId: transfer.taskId, userId: actor.userId } }, create: { taskId: transfer.taskId, userId: actor.userId }, update: { declinedAt: null } });
    await tx.workTaskTransfer.update({ where: { id: transferId }, data: { status: "ACCEPTED", resolvedAt } });
    await event(tx, transfer.taskId, actor, "TRANSFER", `Transferencia aceptada. ${input.notes}`.trim());
    await tx.auditLog.create({ data: { actorUserId: actor.userId, action: "WORK_TEAM_CHANGED", entityType: "WorkTask", entityId: transfer.taskId, metadata: { transferId, from: transfer.fromUserId, to: actor.userId, reason: transfer.notes } } });
    await notify(tx, [transfer.fromUserId], `Transferencia aceptada: ${transfer.task.title}`, "/tasks");
    return { message: "Tarea transferida: quedó a su cargo" };
  });
}
export async function assignWork(id: string, input: z.infer<typeof assignWorkSchema>, actor: Actor) {
  if (!isOperationsManager(actor.role)) throw new OperationError(403, "Solo responsables pueden reasignar");
  return serializable(async (tx) => {
    await activePeople(tx, input.userIds);
    const before=await tx.workTaskMember.findMany({where:{taskId:id},select:{userId:true,declinedAt:true}});
    const changed = await tx.workTask.updateMany({ where: { id, revision: input.revision, status: { in: ["ASSIGNED", "RETURNED"] } }, data: { revision: { increment: 1 } } });
    if (!changed.count) throw new OperationError(409, "La tarea cambio o no esta pendiente");
    await tx.workTaskMember.deleteMany({ where: { taskId: id } });
    await tx.workTaskMember.createMany({ data: input.userIds.map((userId) => ({ taskId: id, userId })) });
    await event(tx, id, actor, "REASSIGNED", `${input.notes} [integrantes: ${input.userIds.join(", ")}]`);
    await tx.auditLog.create({data:{actorUserId:actor.userId,action:"WORK_TEAM_CHANGED",entityType:"WorkTask",entityId:id,metadata:{before:JSON.parse(JSON.stringify(before)),after:input.userIds,reason:input.notes}}});
    return tx.workTask.findUniqueOrThrow({ where: { id }, include });
  });
}
export async function planWork(id:string,input:z.infer<typeof planWorkSchema>,actor:Actor){
  if(!isOperationsManager(actor.role))throw new OperationError(403,"Solo jefatura planifica las tareas");
  return serializable(async tx=>{
    const row=await tx.workTask.findUnique({where:{id},include:{maintenanceJob:true,originInspection:true}});
    if(!row||!["ASSIGNED","RETURNED"].includes(row.status)||row.revision!==input.revision)throw new OperationError(409,"La tarea cambió o ya no está pendiente");
    if(row.maintenanceJob&&!["OPEN","IN_PROGRESS"].includes(row.maintenanceJob.status))throw new OperationError(409,"El mantenimiento vinculado está cerrado");
    if(input.responsibleUserId)await activePeople(tx,[input.responsibleUserId]);
    if(row.originInspection&&(!input.responsibleUserId||!input.dueOn))throw new OperationError(400,"La reparación de un control necesita responsable y fecha límite");
    const dueOn=input.dueOn?new Date(input.dueOn):null;
    await tx.workTask.update({where:{id},data:{dueOn,priority:input.priority,revision:{increment:1}}});
    if(input.responsibleUserId)await tx.workTaskMember.upsert({where:{taskId_userId:{taskId:id,userId:input.responsibleUserId}},create:{taskId:id,userId:input.responsibleUserId},update:{declinedAt:null}});
    if(row.maintenanceJobId)await tx.maintenanceJob.update({where:{id:row.maintenanceJobId},data:{dueAt:dueOn,responsibleUserId:input.responsibleUserId,revision:{increment:1}}});
    await event(tx,id,actor,"PLANNED",input.notes);
    await tx.auditLog.create({data:{actorUserId:actor.userId,action:"WORK_PLANNING_UPDATED",entityType:"WorkTask",entityId:id,metadata:{before:{dueOn:row.dueOn?.toISOString()||null,priority:row.priority,responsibleUserId:row.maintenanceJob?.responsibleUserId||null},after:input}}});
    return tx.workTask.findUniqueOrThrow({where:{id},include});
  });
}
