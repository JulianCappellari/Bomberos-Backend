"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.messageFingerprint = void 0;
exports.canReadPrivateProfile = canReadPrivateProfile;
exports.canReadDeclarations = canReadDeclarations;
exports.profile = profile;
exports.updatePersonalProfile = updatePersonalProfile;
exports.declarations = declarations;
exports.saveDeclaration = saveDeclaration;
exports.deleteDeclaration = deleteDeclaration;
exports.availability = availability;
exports.addPeriod = addPeriod;
exports.cancelPeriod = cancelPeriod;
exports.acknowledgement = acknowledgement;
exports.acknowledgementHistory = acknowledgementHistory;
exports.acknowledgementReport = acknowledgementReport;
const chat_audience_1 = require("../chat/chat-audience");
const message_fingerprint_1 = require("../../utils/message-fingerprint");
var message_fingerprint_2 = require("../../utils/message-fingerprint");
Object.defineProperty(exports, "messageFingerprint", { enumerable: true, get: function () { return message_fingerprint_2.messageFingerprint; } });
const prisma_1 = require("../../config/prisma");
const transaction_1 = require("../../utils/transaction");
const public_user_1 = require("../../utils/public-user");
const operations_schemas_1 = require("../operations/operations.schemas");
const members_schemas_1 = require("./members.schemas");
const station_time_1 = require("../../utils/station-time");
const operational_availability_1 = require("./operational-availability");
const alert_notifications_1 = require("../alerts/alert-notifications");
const notifications_service_1 = require("./notifications.service");
function canReadPrivateProfile(actor, userId) { return actor.userId === userId || ["ADMIN", "OPERATOR"].includes(actor.role); }
// C06: la guardia ve contacto de emergencia y grupo sanguineo solo mientras hay una emergencia activa.
async function guardInEmergency(actor) {
    return actor.role === "GUARD" && Boolean(await prisma_1.prisma.alert.findFirst({ where: { status: "ACTIVE" }, select: { id: true } }) || await prisma_1.prisma.incident.findFirst({ where: { status: "OPEN" }, select: { id: true } }));
}
function canReadDeclarations(actor, userId, category) { return actor.userId === userId || actor.role === "ADMIN" || category === "DRIVER_LICENSE" && actor.role === "OPERATOR"; }
async function audit(tx, actor, action, id) {
    await tx.auditLog.create({ data: { actorUserId: actor.userId, action, entityType: "Member", entityId: id } });
}
async function profile(userId, actor) {
    const emergencyOnly = !canReadPrivateProfile(actor, userId) && await guardInEmergency(actor);
    if (!canReadPrivateProfile(actor, userId) && !emergencyOnly)
        throw new operations_schemas_1.OperationError(403, "Perfil privado");
    return prisma_1.prisma.$transaction(async (tx) => {
        const row = await tx.user.findFirst({ where: { id: userId, deletedAt: null }, select: { id: true, username: true, email: true, profile: true, emergencyContact: true } });
        if (!row)
            throw new operations_schemas_1.OperationError(404, "Personal no encontrado");
        if (emergencyOnly) {
            await audit(tx, actor, "EMERGENCY_DATA_VIEWED_BY_GUARD", userId);
            return { id: row.id, username: row.username, profile: row.profile ? { fullName: row.profile.fullName, rank: row.profile.rank, bloodType: row.profile.bloodType } : null, emergencyContact: row.emergencyContact };
        }
        if (userId !== actor.userId)
            await audit(tx, actor, "PRIVATE_PROFILE_VIEWED", userId);
        return row;
    });
}
async function updatePersonalProfile(input, actor) {
    return (0, transaction_1.serializable)(async (tx) => {
        const { emergencyContact, revision, email, ...fields } = input;
        // C05: el correo se actualiza sin aprobacion, validando que no pertenezca a otra cuenta.
        if (email !== undefined) {
            if (email && await tx.user.findFirst({ where: { email, id: { not: actor.userId } }, select: { id: true } }))
                throw new operations_schemas_1.OperationError(409, "Ese correo ya pertenece a otra cuenta");
            await tx.user.update({ where: { id: actor.userId }, data: { email: email || null } });
        }
        const changed = await tx.firefighterProfile.updateMany({ where: { userId: actor.userId, updatedAt: new Date(revision) }, data: fields });
        if (!changed.count)
            throw new operations_schemas_1.OperationError(409, "El perfil cambio o aun no fue creado por administracion. Recargue antes de editar");
        await tx.emergencyContact.upsert({ where: { userId: actor.userId }, create: { ...emergencyContact, userId: actor.userId }, update: emergencyContact });
        await audit(tx, actor, "PERSONAL_PROFILE_UPDATED", actor.userId);
        return { message: "Perfil actualizado" };
    });
}
async function declarations(userId, category, actor) {
    if (!canReadDeclarations(actor, userId, category))
        throw new operations_schemas_1.OperationError(403, "No puede consultar declaraciones ajenas");
    return prisma_1.prisma.$transaction(async (tx) => {
        if (userId !== actor.userId)
            await audit(tx, actor, "PERSONAL_DECLARATIONS_VIEWED", userId);
        return tx.personalDeclaration.findMany({ where: { userId, category, deletedAt: null }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 200 });
    });
}
async function saveDeclaration(id, input, actor) {
    if (input.license && input.license.issuedOn > (0, station_time_1.stationDate)())
        throw new operations_schemas_1.OperationError(400, "La fecha de emision no puede ser futura");
    const fields = { title: input.title, details: input.details, licenseNumber: input.license?.number || null, issuer: input.license?.issuer || null, licenseClasses: input.license?.classes || [], issuedOn: input.license ? new Date(input.license.issuedOn) : null, expiresOn: input.license ? new Date(input.license.expiresOn) : null };
    Object.assign(fields, { clothingBrand: input.clothing?.brand ?? null, clothingModel: input.clothing?.model ?? null, clothingSize: input.clothing?.size ?? null, clothingCondition: input.clothing?.condition ?? null, clothingNovelties: input.clothing?.novelties ?? null });
    return (0, transaction_1.serializable)(async (tx) => {
        let row;
        if (id) {
            const parsed = members_schemas_1.declarationEditSchema.parse(input);
            const before = await tx.personalDeclaration.findUnique({ where: { id } });
            const changed = await tx.personalDeclaration.updateMany({ where: { id, userId: actor.userId, category: input.category, revision: parsed.revision, deletedAt: null }, data: { ...fields, revision: { increment: 1 } } });
            if (!changed.count)
                throw new operations_schemas_1.OperationError(409, "La declaracion cambio o no es propia");
            row = await tx.personalDeclaration.findUniqueOrThrow({ where: { id } });
            if (before && row.category === "DRIVER_LICENSE") {
                const sameLicense = before.licenseNumber === row.licenseNumber && [...before.licenseClasses].sort().join(",") === [...row.licenseClasses].sort().join(",");
                const linked = await tx.vehicleDriverAuthorization.findMany({ where: { licenseId: id, licenseRevision: before.revision } });
                // J04: se mantiene la habilitacion si numero y clases no cambian; rige hasta el nuevo vencimiento (J03).
                if (sameLicense && row.expiresOn)
                    for (const permit of linked)
                        await tx.vehicleDriverAuthorization.update({ where: { assetId_userId: { assetId: permit.assetId, userId: permit.userId } }, data: { licenseRevision: row.revision, validUntil: row.expiresOn, revision: { increment: 1 } } });
                else if (linked.length)
                    await (0, notifications_service_1.notifyCommand)(tx, "Licencia modificada: habilitación de conductor a revalidar", "/incidents/logistics", "Cambió el número o las clases de una licencia que respaldaba habilitaciones vigentes.", actor.userId);
            }
        }
        else {
            if (await tx.personalDeclaration.count({ where: { userId: actor.userId, deletedAt: null } }) >= 200)
                throw new operations_schemas_1.OperationError(409, "Limite de declaraciones activas alcanzado");
            members_schemas_1.declarationSchema.parse(input);
            row = await tx.personalDeclaration.create({ data: { ...fields, category: input.category, userId: actor.userId } });
        }
        await tx.auditLog.create({ data: { actorUserId: actor.userId, action: id ? "DECLARATION_UPDATED" : "DECLARATION_CREATED", entityType: "PersonalDeclaration", entityId: row.id, metadata: { snapshot: JSON.parse(JSON.stringify(row)), userId: actor.userId } } });
        return row;
    });
}
async function deleteDeclaration(id, revision, actor) {
    return (0, transaction_1.serializable)(async (tx) => {
        const changed = await tx.personalDeclaration.updateMany({ where: { id, revision, deletedAt: null, ...(actor.role === "ADMIN" ? {} : { userId: actor.userId }) }, data: { deletedAt: new Date(), revision: { increment: 1 } } });
        if (!changed.count)
            throw new operations_schemas_1.OperationError(409, "La declaracion cambio o no tiene permisos");
        await audit(tx, actor, "DECLARATION_ARCHIVED", id);
        return { message: "Declaracion retirada, historial conservado" };
    });
}
async function availability(actor) {
    const now = new Date();
    const [periods, presence, mission, person] = await prisma_1.prisma.$transaction([
        prisma_1.prisma.emergencyAvailability.findMany({ where: { userId: actor.userId, cancelledAt: null, OR: [{ endsAt: null }, { endsAt: { gt: now } }] }, orderBy: { startsAt: "asc" }, take: 100 }),
        prisma_1.prisma.attendance.findFirst({ where: { userId: actor.userId, status: "OPEN", checkInAt: { lte: now }, checkInQrId: { not: null }, checkInTrust: { not: "REJECTED" } }, select: { id: true } }),
        prisma_1.prisma.missionCrew.findFirst({ where: { userId: actor.userId, movement: { returnedAt: null } }, select: { userId: true } }),
        prisma_1.prisma.user.findUniqueOrThrow({ where: { id: actor.userId }, select: { emergencyStatusConfirmedAt: true } }),
    ], { isolationLevel: "RepeatableRead" });
    const declaredAvailable = !periods.some((p) => p.startsAt <= now && (!p.endsAt || p.endsAt > now));
    return { available: !mission && (Boolean(presence) || declaredAvailable), declaredAvailable, presentByQr: Boolean(presence) && !mission, deployed: Boolean(mission), status: (0, operational_availability_1.operationalStatus)(Boolean(mission), Boolean(presence), !declaredAvailable, Boolean(person.emergencyStatusConfirmedAt)), periods };
}
async function addPeriod(input, actor) {
    const startsAt = new Date(input.startsAt), endsAt = input.endsAt ? new Date(input.endsAt) : null;
    if (endsAt && endsAt <= new Date())
        throw new operations_schemas_1.OperationError(400, "El periodo ya termino");
    return (0, transaction_1.serializable)(async (tx) => {
        if (await tx.emergencyAvailability.count({ where: { userId: actor.userId, cancelledAt: null, OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }] } }) >= 100)
            throw new operations_schemas_1.OperationError(409, "Limite de periodos activos alcanzado");
        const row = await tx.emergencyAvailability.create({ data: { userId: actor.userId, startsAt, endsAt } });
        await audit(tx, actor, "EMERGENCY_UNAVAILABILITY_CREATED", row.id);
        return row;
    });
}
async function cancelPeriod(id, actor) {
    return (0, transaction_1.serializable)(async (tx) => {
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
        if (!id)
            await tx.user.update({ where: { id: actor.userId }, data: { emergencyStatusConfirmedAt: now } });
        const result = await tx.emergencyAvailability.updateMany({ where: { userId: actor.userId, cancelledAt: null, ...(id ? { id } : { startsAt: { lte: now }, OR: [{ endsAt: null }, { endsAt: { gt: now } }] }) }, data: { cancelledAt: now } });
        await audit(tx, actor, id ? "EMERGENCY_PERIOD_CANCELLED" : "EMERGENCY_AVAILABLE_NOW", id || actor.userId);
        if (!id || activePeriod) {
            const activeAlerts = await tx.alert.findMany({
                where: { status: "ACTIVE" },
                select: { id: true, priority: true },
            });
            for (const alert of activeAlerts)
                await (0, alert_notifications_1.notifyAlert)(tx, alert, actor.userId);
        }
        return { changed: result.count };
    });
}
async function acknowledgement(id, actor, expectedHash) {
    return (0, transaction_1.serializable)(async (tx) => {
        // Lock the message so acknowledgement cannot race an edit or withdrawal.
        await tx.$queryRaw `SELECT "id" FROM "ChatMessage" WHERE "id" = ${id} FOR UPDATE`;
        const message = await tx.chatMessage.findFirst({ where: { id, deletedAt: null } });
        if (!message)
            throw new operations_schemas_1.OperationError(404, "Mensaje no encontrado");
        if (message.audience !== "ALL" && message.authorUserId !== actor.userId && !(await (0, chat_audience_1.audienceMemberIds)(tx, message.audience)).includes(actor.userId) && actor.role !== "ADMIN" && actor.role !== "OPERATOR")
            throw new operations_schemas_1.OperationError(403, "Este mensaje es para otro grupo");
        const contentHash = (0, message_fingerprint_1.messageFingerprint)(message);
        if (expectedHash && expectedHash !== contentHash)
            throw new operations_schemas_1.OperationError(409, "El mensaje fue editado. Lea la version actual antes de confirmar");
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
async function acknowledgementHistory(id, actor) {
    if (actor.role !== "ADMIN")
        throw new operations_schemas_1.OperationError(403, "Solo administracion puede consultar acuses ajenos");
    return prisma_1.prisma.chatAcknowledgement.findMany({ where: { messageId: id }, include: { user: { select: public_user_1.PUBLIC_USER_SELECT } }, orderBy: { acknowledgedAt: "desc" }, take: 200 });
}
async function acknowledgementReport(id, actor) {
    if (actor.role !== "ADMIN")
        throw new operations_schemas_1.OperationError(403, "Solo administracion puede consultar las lecturas");
    return prisma_1.prisma.$transaction(async (tx) => {
        const message = await tx.chatMessage.findUnique({ where: { id }, select: { id: true, body: true, createdAt: true, editedAt: true, deletedAt: true, author: { select: public_user_1.PUBLIC_USER_SELECT } } });
        if (!message)
            throw new operations_schemas_1.OperationError(404, "Mensaje no encontrado");
        const receipts = await tx.chatAcknowledgement.findMany({ where: { messageId: id }, select: { id: true, userId: true, contentHash: true, bodySnapshot: true, acknowledgedAt: true, user: { select: public_user_1.PUBLIC_USER_SELECT } }, orderBy: [{ acknowledgedAt: "desc" }, { id: "asc" }] });
        await tx.auditLog.create({ data: { actorUserId: actor.userId, action: "MESSAGE_RECEIPTS_VIEWED", entityType: "ChatMessage", entityId: id, metadata: { confirmations: receipts.length } } });
        return { message, contentHash: (0, message_fingerprint_1.messageFingerprint)(message), receipts };
    }, { isolationLevel: "RepeatableRead" });
}
