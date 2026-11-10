"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.evaluateComplianceStatus = evaluateComplianceStatus;
exports.listComplianceRecords = listComplianceRecords;
exports.getComplianceSummary = getComplianceSummary;
exports.createComplianceRecord = createComplianceRecord;
exports.updateComplianceRecord = updateComplianceRecord;
exports.deleteComplianceRecord = deleteComplianceRecord;
const prisma_1 = require("../../config/prisma");
function evaluateComplianceStatus(expiresAt, warningDays, now = new Date()) {
    if (!expiresAt)
        return { status: "NO_EXPIRY", daysRemaining: null };
    const dayMs = 24 * 60 * 60 * 1000;
    const daysRemaining = Math.ceil((expiresAt.getTime() - now.getTime()) / dayMs);
    if (daysRemaining < 0)
        return { status: "EXPIRED", daysRemaining };
    if (daysRemaining <= warningDays)
        return { status: "DUE_SOON", daysRemaining };
    return { status: "VALID", daysRemaining };
}
const RECORD_INCLUDE = {
    user: {
        select: {
            id: true,
            username: true,
            profile: { select: { fullName: true, rank: true, badge: true } },
        },
    },
    asset: {
        select: {
            id: true,
            name: true,
            assetType: true,
            status: true,
            vehicle: { select: { unitNumber: true, plate: true } },
        },
    },
    createdBy: {
        select: {
            id: true,
            username: true,
            profile: { select: { fullName: true } },
        },
    },
};
function serializeRecord(record, now = new Date()) {
    return {
        ...record,
        ...evaluateComplianceStatus(record.expiresAt, record.warningDays, now),
        subjectName: record.user?.profile?.fullName ||
            record.user?.username ||
            record.asset?.name ||
            "Sin sujeto",
    };
}
function dateOrNull(value) {
    return value ? new Date(`${value}T12:00:00.000Z`) : null;
}
function nullable(value) {
    return value?.trim() || null;
}
async function ensureSubject(input) {
    if (input.subjectType === "USER") {
        const user = await prisma_1.prisma.user.findFirst({
            where: {
                id: input.userId || "",
                deletedAt: null,
                isActive: true,
                isPendingApproval: false,
            },
            select: { id: true },
        });
        if (!user)
            throw new Error("Bombero inexistente o no habilitado");
        return;
    }
    const asset = await prisma_1.prisma.asset.findFirst({
        where: { id: input.assetId || "", deletedAt: null },
        select: { id: true },
    });
    if (!asset)
        throw new Error("Vehiculo o equipo inexistente");
}
function recordData(input) {
    return {
        subjectType: input.subjectType,
        userId: input.subjectType === "USER" ? nullable(input.userId) : null,
        assetId: input.subjectType === "ASSET" ? nullable(input.assetId) : null,
        category: input.category,
        title: input.title.trim(),
        issuer: nullable(input.issuer),
        issuedAt: dateOrNull(input.issuedAt),
        expiresAt: dateOrNull(input.expiresAt),
        warningDays: input.warningDays,
        documentUrl: nullable(input.documentUrl),
        notes: nullable(input.notes),
    };
}
async function listComplianceRecords(filters) {
    const records = await prisma_1.prisma.complianceRecord.findMany({
        where: {
            deletedAt: null,
            subjectType: filters.subjectType,
            category: filters.category,
            userId: filters.userId,
            assetId: filters.assetId,
        },
        include: RECORD_INCLUDE,
        orderBy: [{ expiresAt: "asc" }, { createdAt: "desc" }],
    });
    const query = filters.q?.toLocaleLowerCase("es") || null;
    return records
        .map((record) => serializeRecord(record))
        .filter((record) => !filters.status || record.status === filters.status)
        .filter((record) => {
        if (!query)
            return true;
        return [record.title, record.issuer, record.subjectName, record.notes]
            .filter(Boolean)
            .some((value) => value.toLocaleLowerCase("es").includes(query));
    });
}
async function getComplianceSummary() {
    const records = await listComplianceRecords({});
    return {
        total: records.length,
        valid: records.filter((record) => record.status === "VALID").length,
        dueSoon: records.filter((record) => record.status === "DUE_SOON").length,
        expired: records.filter((record) => record.status === "EXPIRED").length,
        noExpiry: records.filter((record) => record.status === "NO_EXPIRY").length,
        critical: records
            .filter((record) => ["EXPIRED", "DUE_SOON"].includes(record.status))
            .slice(0, 8),
    };
}
async function createComplianceRecord(input, actorUserId) {
    await ensureSubject(input);
    const record = await prisma_1.prisma.complianceRecord.create({
        data: { ...recordData(input), createdByUserId: actorUserId },
        include: RECORD_INCLUDE,
    });
    await prisma_1.prisma.auditLog.create({
        data: {
            actorUserId,
            action: "COMPLIANCE_RECORD_CREATED",
            entityType: "ComplianceRecord",
            entityId: record.id,
            metadata: { category: record.category, subjectType: record.subjectType },
        },
    });
    return serializeRecord(record);
}
async function updateComplianceRecord(id, input, actorUserId) {
    const existing = await prisma_1.prisma.complianceRecord.findFirst({
        where: { id, deletedAt: null },
        select: { id: true },
    });
    if (!existing)
        throw new Error("Registro de cumplimiento no encontrado");
    await ensureSubject(input);
    const record = await prisma_1.prisma.complianceRecord.update({
        where: { id },
        data: recordData(input),
        include: RECORD_INCLUDE,
    });
    await prisma_1.prisma.auditLog.create({
        data: {
            actorUserId,
            action: "COMPLIANCE_RECORD_UPDATED",
            entityType: "ComplianceRecord",
            entityId: id,
            metadata: { category: record.category },
        },
    });
    return serializeRecord(record);
}
async function deleteComplianceRecord(id, actorUserId) {
    const existing = await prisma_1.prisma.complianceRecord.findFirst({
        where: { id, deletedAt: null },
    });
    if (!existing)
        throw new Error("Registro de cumplimiento no encontrado");
    await prisma_1.prisma.$transaction([
        prisma_1.prisma.complianceRecord.update({
            where: { id },
            data: { deletedAt: new Date() },
        }),
        prisma_1.prisma.auditLog.create({
            data: {
                actorUserId,
                action: "COMPLIANCE_RECORD_DELETED",
                entityType: "ComplianceRecord",
                entityId: id,
                metadata: { category: existing.category, title: existing.title },
            },
        }),
    ]);
    return { message: "Registro eliminado" };
}
