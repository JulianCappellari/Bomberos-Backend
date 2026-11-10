"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listContacts = listContacts;
exports.createContact = createContact;
exports.updateContact = updateContact;
exports.deleteContact = deleteContact;
const prisma_1 = require("../../config/prisma");
const public_user_1 = require("../../utils/public-user");
class ContactError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}
const include = { createdBy: { select: public_user_1.PUBLIC_USER_SELECT } };
function contactData(input) {
    return {
        name: input.name,
        category: input.category,
        phone: input.phone?.trim() || null,
        radioFrequency: input.radioFrequency?.trim() || null,
        email: input.email?.trim() || null,
        address: input.address?.trim() || null,
        notes: input.notes?.trim() || null,
        isEmergency: input.isEmergency,
    };
}
async function listContacts(filters) {
    const where = {
        deletedAt: null,
        ...(filters.category ? { category: filters.category } : {}),
        ...(filters.emergency ? { isEmergency: filters.emergency === "true" } : {}),
    };
    if (filters.q) {
        where.OR = ["name", "category", "phone", "radioFrequency", "notes"].map((field) => ({
            [field]: { contains: filters.q, mode: "insensitive" },
        }));
    }
    return prisma_1.prisma.operationalContact.findMany({
        where,
        include,
        orderBy: [{ isEmergency: "desc" }, { name: "asc" }, { id: "asc" }],
    });
}
async function createContact(input, actorUserId) {
    return prisma_1.prisma.$transaction(async (tx) => {
        const contact = await tx.operationalContact.create({
            data: { ...contactData(input), createdByUserId: actorUserId },
            include,
        });
        await tx.auditLog.create({
            data: {
                actorUserId, action: "CONTACT_CREATED", entityType: "OperationalContact",
                entityId: contact.id, metadata: { category: contact.category },
            },
        });
        return contact;
    });
}
async function updateContact(id, input, actorUserId) {
    return prisma_1.prisma.$transaction(async (tx) => {
        const changed = await tx.operationalContact.updateMany({
            where: { id, revision: input.revision, deletedAt: null },
            data: { ...contactData(input), revision: { increment: 1 } },
        });
        if (!changed.count)
            throw new ContactError(409, "El contacto fue modificado o eliminado. Recargue la lista antes de editar.");
        const contact = await tx.operationalContact.findUniqueOrThrow({ where: { id }, include });
        await tx.auditLog.create({
            data: {
                actorUserId, action: "CONTACT_UPDATED", entityType: "OperationalContact",
                entityId: id, metadata: { revision: contact.revision },
            },
        });
        return contact;
    });
}
async function deleteContact(id, revision, actorUserId) {
    return prisma_1.prisma.$transaction(async (tx) => {
        const changed = await tx.operationalContact.updateMany({
            where: { id, revision, deletedAt: null },
            data: { deletedAt: new Date(), revision: { increment: 1 } },
        });
        if (!changed.count)
            throw new ContactError(409, "El contacto fue modificado o eliminado. Recargue la lista.");
        await tx.auditLog.create({
            data: {
                actorUserId, action: "CONTACT_DELETED", entityType: "OperationalContact",
                entityId: id, metadata: { revision },
            },
        });
        return { message: "Contacto eliminado" };
    });
}
