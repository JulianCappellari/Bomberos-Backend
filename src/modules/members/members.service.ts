import { audienceMemberIds } from "../chat/chat-audience";
import { messageFingerprint } from "../../utils/message-fingerprint";
export { messageFingerprint } from "../../utils/message-fingerprint";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma";
import { serializable } from "../../utils/transaction";
import { PUBLIC_USER_SELECT } from "../../utils/public-user";
import { OperationError } from "../operations/operations.schemas";
import { Actor } from "../work/work.schemas";
import { declarationEditSchema, declarationSchema, periodSchema, personalProfileSchema } from "./members.schemas";
import { stationDate } from "../../utils/station-time";
import { lockRow } from "../../utils/database-schema";
import {operationalStatus} from "./operational-availability";
import { notifyAlert } from "../alerts/alert-notifications";
import { notifyCommand } from "./notifications.service";
import { syncDriverRequests } from "../incidents/driver-authorizations";

export function canReadPrivateProfile(actor: Actor, userId: string) { return actor.userId === userId || ["ADMIN", "OPERATOR"].includes(actor.role); }
// C06: la guardia ve contacto de emergencia y grupo sanguineo solo mientras hay una emergencia activa.
async function guardInEmergency(actor: Actor) {
  return actor.role === "GUARD" && Boolean(await prisma.alert.findFirst({ where: { status: "ACTIVE" }, select: { id: true } }) || await prisma.incident.findFirst({ where: { status: "OPEN" }, select: { id: true } }));
}
export function canReadDeclarations(actor: Actor, userId: string, category: string) { return actor.userId === userId || actor.role === "ADMIN" || category === "DRIVER_LICENSE" && actor.role === "OPERATOR"; }
async function audit(tx: Prisma.TransactionClient, actor: Actor, action: string, id: string) {
  await tx.auditLog.create({ data: { actorUserId: actor.userId, action, entityType: "Member", entityId: id } });
}
export async function profile(userId: string, actor: Actor) {
  const emergencyOnly = !canReadPrivateProfile(actor, userId) && await guardInEmergency(actor);
  if (!canReadPrivateProfile(actor, userId) && !emergencyOnly) throw new OperationError(403, "Perfil privado");
  return prisma.$transaction(async (tx) => {
    const row = await tx.user.findFirst({ where: { id: userId, deletedAt: null }, select: { id: true, username: true, email: true, profile: true, emergencyContact: true } });
    if (!row) throw new OperationError(404, "Personal no encontrado");
    if (emergencyOnly) {
      await audit(tx, actor, "EMERGENCY_DATA_VIEWED_BY_GUARD", userId);
      return { id: row.id, username: row.username, profile: row.profile ? { fullName: row.profile.fullName, rank: row.profile.rank, bloodType: row.profile.bloodType } : null, emergencyContact: row.emergencyContact };
    }
    if (userId !== actor.userId) await audit(tx, actor, "PRIVATE_PROFILE_VIEWED", userId);
    return row;
  });
}
export async function updatePersonalProfile(input: z.infer<typeof personalProfileSchema>, actor: Actor) {
  return serializable(async (tx) => {
    const { emergencyContact, revision, email, ...fields } = input;
    // C05: el correo se actualiza sin aprobacion, validando que no pertenezca a otra cuenta.
    if (email !== undefined) {
      if (email && await tx.user.findFirst({ where: { email, id: { not: actor.userId } }, select: { id: true } })) throw new OperationError(409, "Ese correo ya pertenece a otra cuenta");
      await tx.user.update({ where: { id: actor.userId }, data: { email: email || null } });
    }
    const changed = await tx.firefighterProfile.updateMany({ where: { userId: actor.userId, updatedAt: new Date(revision) }, data: fields });
    if (!changed.count) throw new OperationError(409, "El perfil cambio o aun no fue creado por administracion. Recargue antes de editar");
    await tx.emergencyContact.upsert({ where: { userId: actor.userId }, create: { ...emergencyContact, userId: actor.userId }, update: emergencyContact });
    await audit(tx, actor, "PERSONAL_PROFILE_UPDATED", actor.userId);
    return { message: "Perfil actualizado" };
  });
}
export async function declarations(userId: string, category: "CLOTHING" | "DRIVER_LICENSE", actor: Actor) {
  if (!canReadDeclarations(actor, userId, category)) throw new OperationError(403, "No puede consultar declaraciones ajenas");
  return prisma.$transaction(async (tx) => {
    if (userId !== actor.userId) await audit(tx, actor, "PERSONAL_DECLARATIONS_VIEWED", userId);
    return tx.personalDeclaration.findMany({ where: { userId, category, deletedAt: null }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 200 });
  });
}
export async function saveDeclaration(id: string | null, input: z.infer<typeof declarationSchema> & { revision?: number }, actor: Actor) {
  if (input.license && input.license.issuedOn > stationDate()) throw new OperationError(400, "La fecha de emision no puede ser futura");
  const fields = { title: input.title, details: input.details, licenseNumber: input.license?.number || null, issuer: input.license?.issuer || null, licenseClasses: input.license?.classes.map((c) => c.code) || [], licenseClassDetails: input.license ? input.license.classes : undefined, issuedOn: input.license ? new Date(input.license.issuedOn) : null, expiresOn: input.license ? new Date(input.license.expiresOn) : null };
  Object.assign(fields, { clothingBrand: input.clothing?.brand ?? null, clothingModel: input.clothing?.model ?? null, clothingSize: input.clothing?.size ?? null, clothingCondition: input.clothing?.condition ?? null, clothingNovelties: input.clothing?.novelties ?? null });
  return serializable(async (tx) => {
    let row;
    if (input.category === "DRIVER_LICENSE" && input.license) {
      const code = input.license.classes[0]!.code;
      const twin = await tx.personalDeclaration.findFirst({ where: { userId: actor.userId, category: "DRIVER_LICENSE", deletedAt: null, licenseClasses: { has: code }, ...(id ? { id: { not: id } } : {}) }, select: { id: true } });
      if (twin) throw new OperationError(409, `Ya tenés cargada una licencia clase ${code}: editala en lugar de cargar otra`);
    }
    if (id) {
      const parsed = declarationEditSchema.parse(input);
      const before = await tx.personalDeclaration.findUnique({ where: { id } });
      const changed = await tx.personalDeclaration.updateMany({ where: { id, userId: actor.userId, category: input.category, revision: parsed.revision, deletedAt: null }, data: { ...fields, revision: { increment: 1 } } });
      if (!changed.count) throw new OperationError(409, "La declaracion cambio o no es propia");
      row = await tx.personalDeclaration.findUniqueOrThrow({ where: { id } });
      if (before && row.category === "DRIVER_LICENSE" && (before.licenseNumber !== row.licenseNumber || before.licenseClasses.join() !== row.licenseClasses.join())) {
        // Cambio de numero o clase: jefatura lo ve; la habilitacion sigue sujeta a que las licencias cubran el movil.
        if (await tx.vehicleDriverAuthorization.count({ where: { userId: actor.userId, status: "APPROVED" } })) await notifyCommand(tx, "Licencia modificada por un conductor habilitado", "/incidents/logistics", `Cambió el número o la clase de su licencia (${row.licenseClasses.join(", ")}). Revisá sus habilitaciones.`, actor.userId);
      }
    } else {
      if (await tx.personalDeclaration.count({ where: { userId: actor.userId, deletedAt: null } }) >= 200) throw new OperationError(409, "Limite de declaraciones activas alcanzado");
      declarationSchema.parse(input);
      row = await tx.personalDeclaration.create({ data: { ...fields, category: input.category, userId: actor.userId } });
    }
    await tx.auditLog.create({ data: { actorUserId: actor.userId, action: id ? "DECLARATION_UPDATED" : "DECLARATION_CREATED", entityType: "PersonalDeclaration", entityId: row.id, metadata: { snapshot: JSON.parse(JSON.stringify(row)), userId: actor.userId } } });
    // Moviles que ahora cubren sus licencias: se genera el pedido de habilitacion para jefatura.
    const requested = row.category === "DRIVER_LICENSE" ? await syncDriverRequests(tx, { userId: actor.userId, reopen: true }) : [];
    return { ...row, driverRequests: requested.length };
  });
}
export async function deleteDeclaration(id: string, revision: number, actor: Actor) {
  return serializable(async (tx) => {
    const changed = await tx.personalDeclaration.updateMany({ where: { id, revision, deletedAt: null, ...(actor.role === "ADMIN" ? {} : { userId: actor.userId }) }, data: { deletedAt: new Date(), revision: { increment: 1 } } });
    if (!changed.count) throw new OperationError(409, "La declaracion cambio o no tiene permisos");
    await audit(tx, actor, "DECLARATION_ARCHIVED", id);
    return { message: "Declaracion retirada, historial conservado" };
  });
}
export async function availability(actor: Actor) {
  const now = new Date();
  const [periods, presence, mission, person] = await prisma.$transaction([
    prisma.emergencyAvailability.findMany({ where: { userId: actor.userId, cancelledAt: null, OR: [{ endsAt: null }, { endsAt: { gt: now } }] }, orderBy: { startsAt: "asc" }, take: 100 }),
    prisma.attendance.findFirst({ where: { userId: actor.userId, status: "OPEN", checkInAt: { lte: now }, checkInQrId: { not: null }, checkInTrust: { not: "REJECTED" } }, select: { id: true } }),
    prisma.missionCrew.findFirst({where:{userId:actor.userId,movement:{returnedAt:null}},select:{userId:true}}),
    prisma.user.findUniqueOrThrow({where:{id:actor.userId},select:{emergencyStatusConfirmedAt:true}}),
  ], { isolationLevel: "RepeatableRead" });
  const declaredAvailable = !periods.some((p) => p.startsAt <= now && (!p.endsAt || p.endsAt > now));
  return { available: !mission && (Boolean(presence) || declaredAvailable), declaredAvailable, presentByQr: Boolean(presence)&&!mission, deployed:Boolean(mission), status:operationalStatus(Boolean(mission),Boolean(presence),!declaredAvailable,Boolean(person.emergencyStatusConfirmedAt)), periods };
}
export async function addPeriod(input: z.infer<typeof periodSchema>, actor: Actor) {
  const startsAt = new Date(input.startsAt), endsAt = input.endsAt ? new Date(input.endsAt) : null;
  if (endsAt && endsAt <= new Date()) throw new OperationError(400, "El periodo ya termino");
  return serializable(async (tx) => {
    if (await tx.emergencyAvailability.count({ where: { userId: actor.userId, cancelledAt: null, OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }] } }) >= 100) throw new OperationError(409, "Limite de periodos activos alcanzado");
    const row = await tx.emergencyAvailability.create({ data: { userId: actor.userId, startsAt, endsAt } });
    await audit(tx, actor, "EMERGENCY_UNAVAILABILITY_CREATED", row.id);
    return row;
  });
}
export async function cancelPeriod(id: string | null, actor: Actor) {
  return serializable(async (tx) => {
    const now = new Date();
    const activePeriod = id
      ? await tx.emergencyAvailability.findFirst({
          where: {
            id,
            userId: actor.userId,
            cancelledAt: null,
            startsAt: { lte: now },
            OR: [{ endsAt: null }, { endsAt: { gt: now } }],
          },
          select: { id: true },
        })
      : null;
    if(!id)await tx.user.update({where:{id:actor.userId},data:{emergencyStatusConfirmedAt:now}});
    const result = await tx.emergencyAvailability.updateMany({ where: { userId: actor.userId, cancelledAt: null, ...(id ? { id } : { startsAt: { lte: now }, OR: [{ endsAt: null }, { endsAt: { gt: now } }] }) }, data: { cancelledAt: now } });
    await audit(tx, actor, id ? "EMERGENCY_PERIOD_CANCELLED" : "EMERGENCY_AVAILABLE_NOW", id || actor.userId);
    if (!id || activePeriod) {
      const activeAlerts = await tx.alert.findMany({
        where: { status: "ACTIVE" },
        select: { id: true, priority: true },
      });
      for (const alert of activeAlerts) await notifyAlert(tx, alert, actor.userId);
    }
    return { changed: result.count };
  });
}
export async function acknowledgement(id: string, actor: Actor, expectedHash?: string) {
  return serializable(async (tx) => {
    // Lock the message so acknowledgement cannot race an edit or withdrawal.
    await lockRow(tx, "ChatMessage", id);
    const message = await tx.chatMessage.findFirst({ where: { id, deletedAt: null } });
    if (!message) throw new OperationError(404, "Mensaje no encontrado");
    if (message.audience !== "ALL" && message.authorUserId !== actor.userId && !(await audienceMemberIds(tx, message.audience)).includes(actor.userId) && actor.role !== "ADMIN" && actor.role !== "OPERATOR") throw new OperationError(403, "Este mensaje es para otro grupo");
    const contentHash = messageFingerprint(message);
    if (expectedHash && expectedHash !== contentHash) throw new OperationError(409, "El mensaje fue editado. Lea la version actual antes de confirmar");
    if (expectedHash) {
      const exists = await tx.chatAcknowledgement.findUnique({ where: { messageId_userId_contentHash: { messageId: id, userId: actor.userId, contentHash } } });
      if (!exists) {
        await tx.chatAcknowledgement.create({ data: { messageId: id, userId: actor.userId, contentHash, bodySnapshot: message.body } });
        await audit(tx, actor, "MESSAGE_ACKNOWLEDGED", id);
      }
    }
    const own = await tx.chatAcknowledgement.findUnique({ where: { messageId_userId_contentHash: { messageId: id, userId: actor.userId, contentHash } } });
    return { contentHash, body: message.body, version: (message.editedAt || message.createdAt).toISOString(), acknowledgedAt: own?.acknowledgedAt || null };
  });
}
export async function acknowledgementHistory(id: string, actor: Actor) {
  if (actor.role !== "ADMIN") throw new OperationError(403, "Solo administracion puede consultar acuses ajenos");
  return prisma.chatAcknowledgement.findMany({ where: { messageId: id }, include: { user: { select: PUBLIC_USER_SELECT } }, orderBy: { acknowledgedAt: "desc" }, take: 200 });
}
export async function acknowledgementReport(id: string, actor: Actor) {
  if (actor.role !== "ADMIN") throw new OperationError(403, "Solo administracion puede consultar las lecturas");
  return prisma.$transaction(async tx => {
    const message = await tx.chatMessage.findUnique({ where: { id }, select: { id: true, body: true, createdAt: true, editedAt: true, deletedAt: true, author: { select: PUBLIC_USER_SELECT } } });
    if (!message) throw new OperationError(404, "Mensaje no encontrado");
    const receipts = await tx.chatAcknowledgement.findMany({ where: { messageId: id }, select: { id: true, userId: true, contentHash: true, bodySnapshot: true, acknowledgedAt: true, user: { select: PUBLIC_USER_SELECT } }, orderBy: [{ acknowledgedAt: "desc" }, { id: "asc" }] });
    await tx.auditLog.create({ data: { actorUserId: actor.userId, action: "MESSAGE_RECEIPTS_VIEWED", entityType: "ChatMessage", entityId: id, metadata: { confirmations: receipts.length } } });
    return { message, contentHash: messageFingerprint(message), receipts };
  }, { isolationLevel: "RepeatableRead" });
}
