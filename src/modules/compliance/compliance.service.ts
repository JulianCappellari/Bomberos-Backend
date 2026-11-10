import {
  ComplianceCategory,
  ComplianceSubjectType,
  Prisma,
} from "@prisma/client";
import { prisma } from "../../config/prisma";

export type ComplianceStatus = "VALID" | "DUE_SOON" | "EXPIRED" | "NO_EXPIRY";

export function evaluateComplianceStatus(
  expiresAt: Date | null,
  warningDays: number,
  now = new Date(),
): { status: ComplianceStatus; daysRemaining: number | null } {
  if (!expiresAt) return { status: "NO_EXPIRY", daysRemaining: null };

  const dayMs = 24 * 60 * 60 * 1000;
  const daysRemaining = Math.ceil((expiresAt.getTime() - now.getTime()) / dayMs);
  if (daysRemaining < 0) return { status: "EXPIRED", daysRemaining };
  if (daysRemaining <= warningDays) return { status: "DUE_SOON", daysRemaining };
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
} satisfies Prisma.ComplianceRecordInclude;

type RecordWithRelations = Prisma.ComplianceRecordGetPayload<{
  include: typeof RECORD_INCLUDE;
}>;

function serializeRecord(record: RecordWithRelations, now = new Date()) {
  return {
    ...record,
    ...evaluateComplianceStatus(record.expiresAt, record.warningDays, now),
    subjectName:
      record.user?.profile?.fullName ||
      record.user?.username ||
      record.asset?.name ||
      "Sin sujeto",
  };
}

function dateOrNull(value?: string | null) {
  return value ? new Date(`${value}T12:00:00.000Z`) : null;
}

function nullable(value?: string | null) {
  return value?.trim() || null;
}

async function ensureSubject(input: {
  subjectType: ComplianceSubjectType;
  userId?: string | null;
  assetId?: string | null;
}) {
  if (input.subjectType === "USER") {
    const user = await prisma.user.findFirst({
      where: {
        id: input.userId || "",
        deletedAt: null,
        isActive: true,
        isPendingApproval: false,
      },
      select: { id: true },
    });
    if (!user) throw new Error("Bombero inexistente o no habilitado");
    return;
  }

  const asset = await prisma.asset.findFirst({
    where: { id: input.assetId || "", deletedAt: null },
    select: { id: true },
  });
  if (!asset) throw new Error("Vehiculo o equipo inexistente");
}

type ComplianceInput = {
  subjectType: ComplianceSubjectType;
  userId?: string | null;
  assetId?: string | null;
  category: ComplianceCategory;
  title: string;
  issuer?: string | null;
  issuedAt?: string | null;
  expiresAt?: string | null;
  warningDays: number;
  documentUrl?: string | null;
  notes?: string | null;
};

function recordData(input: ComplianceInput) {
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

export async function listComplianceRecords(filters: {
  subjectType?: ComplianceSubjectType;
  category?: ComplianceCategory;
  status?: ComplianceStatus;
  userId?: string;
  assetId?: string;
  q?: string;
}) {
  const records = await prisma.complianceRecord.findMany({
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
      if (!query) return true;
      return [record.title, record.issuer, record.subjectName, record.notes]
        .filter(Boolean)
        .some((value) => value!.toLocaleLowerCase("es").includes(query));
    });
}

export async function getComplianceSummary() {
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

export async function createComplianceRecord(
  input: ComplianceInput,
  actorUserId: string,
) {
  await ensureSubject(input);
  const record = await prisma.complianceRecord.create({
    data: { ...recordData(input), createdByUserId: actorUserId },
    include: RECORD_INCLUDE,
  });
  await prisma.auditLog.create({
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

export async function updateComplianceRecord(
  id: string,
  input: ComplianceInput,
  actorUserId: string,
) {
  const existing = await prisma.complianceRecord.findFirst({
    where: { id, deletedAt: null },
    select: { id: true },
  });
  if (!existing) throw new Error("Registro de cumplimiento no encontrado");

  await ensureSubject(input);
  const record = await prisma.complianceRecord.update({
    where: { id },
    data: recordData(input),
    include: RECORD_INCLUDE,
  });
  await prisma.auditLog.create({
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

export async function deleteComplianceRecord(id: string, actorUserId: string) {
  const existing = await prisma.complianceRecord.findFirst({
    where: { id, deletedAt: null },
  });
  if (!existing) throw new Error("Registro de cumplimiento no encontrado");

  await prisma.$transaction([
    prisma.complianceRecord.update({
      where: { id },
      data: { deletedAt: new Date() },
    }),
    prisma.auditLog.create({
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
