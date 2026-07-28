import "dotenv/config";
import bcrypt from "bcrypt";
import {
  AlertPriority,
  AlertResponseType,
  AlertStatus,
  AlertType,
  ApplicationStatus,
  AssetStatus,
  AssetType,
  AttendanceMethod,
  AttendanceStatus,
  AttendanceTrustLevel,
  AttendanceType,
  IncidentStatus,
  InspectionItemResult,
  InventoryItemState,
  PrismaClient,
  UserRole,
} from "@prisma/client";
import {
  isAllowedFirefighterRank,
  normalizeRank,
} from "../src/utils/firefighter-ranks";

const prisma = new PrismaClient();

const DEMO_PASSWORD = "Bomberos2026!";

function dateWithOffset(daysOffset: number, hour = 0, minute = 0) {
  const date = new Date();
  date.setDate(date.getDate() + daysOffset);
  date.setHours(hour, minute, 0, 0);
  return date;
}

function dateKeyWithOffset(daysOffset: number) {
  const date = dateWithOffset(daysOffset, 12, 0);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateOnly(daysOffset: number) {
  return new Date(`${dateKeyWithOffset(daysOffset)}T00:00:00.000Z`);
}

function minutesBetween(start: Date, end: Date) {
  return Math.max(0, Math.floor((end.getTime() - start.getTime()) / 60000));
}

async function upsertUser(data: {
  id: string;
  username: string;
  email: string;
  role: UserRole;
  isActive?: boolean;
  isPendingApproval?: boolean;
  profile: {
    fullName: string;
    dni: string;
    rank: string;
    badge: string;
    phone: string;
    bloodType: string;
    address: string;
    joinDate: Date;
  };
  emergencyContact: {
    fullName: string;
    phone: string;
    relationship: string;
  };
  passwordHash: string;
}) {
  const user = await prisma.user.upsert({
    where: { username: data.username },
    update: {
      email: data.email,
      passwordHash: data.passwordHash,
      role: data.role,
      isActive: data.isActive ?? true,
      isPendingApproval: data.isPendingApproval ?? false,
      deletedAt: null,
    },
    create: {
      id: data.id,
      username: data.username,
      email: data.email,
      passwordHash: data.passwordHash,
      role: data.role,
      isActive: data.isActive ?? true,
      isPendingApproval: data.isPendingApproval ?? false,
    },
  });

  await prisma.firefighterProfile.upsert({
    where: { userId: user.id },
    update: data.profile,
    create: {
      userId: user.id,
      ...data.profile,
    },
  });

  await prisma.emergencyContact.upsert({
    where: { userId: user.id },
    update: data.emergencyContact,
    create: {
      userId: user.id,
      ...data.emergencyContact,
    },
  });

  return prisma.user.findUniqueOrThrow({
    where: { id: user.id },
    include: { profile: true },
  });
}

async function upsertShift(data: {
  id: string;
  dateOffset: number;
  startTime: string;
  endTime: string;
  shiftType: string;
  notes?: string;
  createdByUserId: string;
  assignedUserIds: string[];
}) {
  const shift = await prisma.shift.upsert({
    where: { id: data.id },
    update: {
      date: dateOnly(data.dateOffset),
      startTime: data.startTime,
      endTime: data.endTime,
      shiftType: data.shiftType,
      notes: data.notes ?? null,
      createdByUserId: data.createdByUserId,
    },
    create: {
      id: data.id,
      date: dateOnly(data.dateOffset),
      startTime: data.startTime,
      endTime: data.endTime,
      shiftType: data.shiftType,
      notes: data.notes ?? null,
      createdByUserId: data.createdByUserId,
    },
  });

  await prisma.shiftAssignment.deleteMany({
    where: { shiftId: shift.id },
  });

  await prisma.shiftAssignment.createMany({
    data: data.assignedUserIds.map((userId) => ({
      shiftId: shift.id,
      userId,
    })),
    skipDuplicates: true,
  });
}

async function upsertVehicle(data: {
  assetId: string;
  assetName: string;
  status: AssetStatus;
  notes: string;
  unitNumber: string;
  plate: string;
  year: number;
  mileage: number;
  nextOilChangeMileage: number;
}) {
  const asset = await prisma.asset.upsert({
    where: { id: data.assetId },
    update: {
      name: data.assetName,
      assetType: AssetType.VEHICLE,
      status: data.status,
      notes: data.notes,
      deletedAt: null,
    },
    create: {
      id: data.assetId,
      name: data.assetName,
      assetType: AssetType.VEHICLE,
      status: data.status,
      notes: data.notes,
    },
  });

  return prisma.vehicle.upsert({
    where: { assetId: asset.id },
    update: {
      unitNumber: data.unitNumber,
      plate: data.plate,
      year: data.year,
      mileage: data.mileage,
      nextOilChangeMileage: data.nextOilChangeMileage,
    },
    create: {
      assetId: asset.id,
      unitNumber: data.unitNumber,
      plate: data.plate,
      year: data.year,
      mileage: data.mileage,
      nextOilChangeMileage: data.nextOilChangeMileage,
    },
  });
}

async function upsertCompartment(data: {
  vehicleId: string;
  name: string;
  description: string;
  sortOrder: number;
}) {
  return prisma.vehicleCompartment.upsert({
    where: {
      vehicleId_name: {
        vehicleId: data.vehicleId,
        name: data.name,
      },
    },
    update: {
      description: data.description,
      sortOrder: data.sortOrder,
    },
    create: data,
  });
}

async function upsertInventoryItem(data: {
  id: string;
  compartmentId: string;
  name: string;
  expectedQuantity: number;
  state?: InventoryItemState;
  notes?: string | null;
}) {
  return prisma.vehicleInventoryItem.upsert({
    where: { id: data.id },
    update: {
      compartmentId: data.compartmentId,
      name: data.name,
      expectedQuantity: data.expectedQuantity,
      state: data.state ?? InventoryItemState.OK,
      notes: data.notes ?? null,
    },
    create: {
      id: data.id,
      compartmentId: data.compartmentId,
      name: data.name,
      expectedQuantity: data.expectedQuantity,
      state: data.state ?? InventoryItemState.OK,
      notes: data.notes ?? null,
    },
  });
}

function inventoryStateForInspectionResult(result: InspectionItemResult) {
  if (result === InspectionItemResult.OK) return InventoryItemState.OK;
  if (result === InspectionItemResult.MISSING) return InventoryItemState.OUT;
  return InventoryItemState.REVIEW;
}

function assetStatusForInspection(summary: {
  summaryMissing: number;
  summaryDamaged: number;
  summaryUnchecked: number;
}) {
  if (
    summary.summaryMissing > 0 ||
    summary.summaryDamaged > 0 ||
    summary.summaryUnchecked > 0
  ) {
    return AssetStatus.MAINTENANCE;
  }

  return AssetStatus.OPERATIONAL;
}

function coerceLegacyRank(rank: string) {
  if (isAllowedFirefighterRank(rank)) return rank;

  const normalized = normalizeRank(rank).replace(/\s/g, "");

  if (normalized.includes("aspirante")) return "Aspirante";
  if (normalized.includes("suboficial")) return "Sub oficial";
  if (
    normalized.includes("oficial") ||
    normalized.includes("jefe") ||
    normalized.includes("operador")
  ) {
    return "Oficial";
  }

  return "Bombero";
}

async function repairLegacyRanks() {
  const profiles = await prisma.firefighterProfile.findMany({
    select: {
      id: true,
      rank: true,
    },
  });

  for (const profile of profiles) {
    const nextRank = coerceLegacyRank(profile.rank);
    if (nextRank === profile.rank) continue;

    await prisma.firefighterProfile.update({
      where: { id: profile.id },
      data: {
        rank: nextRank,
      },
    });
  }
}

async function seedInspection(data: {
  id: string;
  vehicleId: string;
  incidentType: AlertType;
  inspectionDate: Date;
  inspectionTime: string;
  observations: string;
  responsibleUserIds: string[];
  items: Array<{
    inventoryItemId: string;
    expectedQuantity: number;
    result: InspectionItemResult;
    observations?: string | null;
  }>;
}) {
  const summaryOk = data.items.filter(
    (item) => item.result === InspectionItemResult.OK,
  ).length;
  const summaryMissing = data.items.filter(
    (item) => item.result === InspectionItemResult.MISSING,
  ).length;
  const summaryDamaged = data.items.filter(
    (item) => item.result === InspectionItemResult.DAMAGED,
  ).length;
  const summaryUnchecked = data.items.filter(
    (item) => item.result === InspectionItemResult.UNCHECKED,
  ).length;

  await prisma.inspection.upsert({
    where: { id: data.id },
    update: {
      vehicleId: data.vehicleId,
      incidentType: data.incidentType,
      inspectionDate: data.inspectionDate,
      inspectionTime: data.inspectionTime,
      observations: data.observations,
      summaryOk,
      summaryMissing,
      summaryDamaged,
      summaryUnchecked,
    },
    create: {
      id: data.id,
      vehicleId: data.vehicleId,
      incidentType: data.incidentType,
      inspectionDate: data.inspectionDate,
      inspectionTime: data.inspectionTime,
      observations: data.observations,
      summaryOk,
      summaryMissing,
      summaryDamaged,
      summaryUnchecked,
    },
  });

  await prisma.inspectionResponsible.deleteMany({
    where: { inspectionId: data.id },
  });

  await prisma.inspectionResponsible.createMany({
    data: data.responsibleUserIds.map((userId) => ({
      inspectionId: data.id,
      userId,
    })),
    skipDuplicates: true,
  });

  await prisma.inspectionItem.deleteMany({
    where: { inspectionId: data.id },
  });

  await prisma.inspectionItem.createMany({
    data: data.items.map((item, index) => ({
      id: `${data.id}_item_${index + 1}`,
      inspectionId: data.id,
      inventoryItemId: item.inventoryItemId,
      expectedQuantity: item.expectedQuantity,
      result: item.result,
      observations: item.observations ?? null,
    })),
  });

  for (const item of data.items) {
    await prisma.vehicleInventoryItem.update({
      where: { id: item.inventoryItemId },
      data: {
        state: inventoryStateForInspectionResult(item.result),
      },
    });
  }

  const vehicle = await prisma.vehicle.findUnique({
    where: { id: data.vehicleId },
    select: { assetId: true },
  });

  if (vehicle) {
    await prisma.asset.update({
      where: { id: vehicle.assetId },
      data: {
        lastCheckDate: data.inspectionDate,
        status: assetStatusForInspection({
          summaryMissing,
          summaryDamaged,
          summaryUnchecked,
        }),
      },
    });
  }
}

async function main() {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

  const station = await prisma.station.upsert({
    where: { id: "station_sampacho_dev" },
    update: {
      name: "Cuartel Sampacho",
      latitude: -33.3827,
      longitude: -64.7228,
      radiusMeters: 180,
      allowedIp: null,
    },
    create: {
      id: "station_sampacho_dev",
      name: "Cuartel Sampacho",
      latitude: -33.3827,
      longitude: -64.7228,
      radiusMeters: 180,
    },
  });

  const routeStation = await prisma.station.upsert({
    where: { id: "station_ruta_8_seed" },
    update: {
      name: "Destacamento Ruta 8",
      latitude: -33.356,
      longitude: -64.746,
      radiusMeters: 150,
      allowedIp: null,
    },
    create: {
      id: "station_ruta_8_seed",
      name: "Destacamento Ruta 8",
      latitude: -33.356,
      longitude: -64.746,
      radiusMeters: 150,
    },
  });

  const admin = await upsertUser({
    id: "user_admin_seed",
    username: "admin",
    email: "admin@sampacho.local",
    role: UserRole.ADMIN,
    profile: {
      fullName: "Julian Administrador",
      dni: "30000001",
      rank: "Oficial",
      badge: "J-001",
      phone: "3584000001",
      bloodType: "O+",
      address: "Cuartel Central 100",
      joinDate: new Date("2014-03-01T00:00:00.000Z"),
    },
    emergencyContact: {
      fullName: "Contacto Admin",
      phone: "3584999001",
      relationship: "Familiar",
    },
    passwordHash,
  });

  const operator = await upsertUser({
    id: "user_operator_seed",
    username: "operador",
    email: "operador@sampacho.local",
    role: UserRole.OPERATOR,
    profile: {
      fullName: "Carla Operadora",
      dni: "30000002",
      rank: "Sub oficial",
      badge: "O-010",
      phone: "3584000002",
      bloodType: "A+",
      address: "Central 24",
      joinDate: new Date("2018-06-12T00:00:00.000Z"),
    },
    emergencyContact: {
      fullName: "Miguel Operador",
      phone: "3584999002",
      relationship: "Padre",
    },
    passwordHash,
  });

  const chief = await upsertUser({
    id: "user_chief_seed",
    username: "jefe_guardia",
    email: "jefe.guardias@sampacho.local",
    role: UserRole.FIREFIGHTER,
    profile: {
      fullName: "Diego Alvarez",
      dni: "30000003",
      rank: "Sub oficial",
      badge: "B-101",
      phone: "3584000003",
      bloodType: "B+",
      address: "San Martin 455",
      joinDate: new Date("2016-09-10T00:00:00.000Z"),
    },
    emergencyContact: {
      fullName: "Laura Alvarez",
      phone: "3584999003",
      relationship: "Conyuge",
    },
    passwordHash,
  });

  const martin = await upsertUser({
    id: "user_martin_seed",
    username: "bombero_martin",
    email: "martin@sampacho.local",
    role: UserRole.FIREFIGHTER,
    profile: {
      fullName: "Martin Gomez",
      dni: "30000004",
      rank: "Bombero",
      badge: "B-201",
      phone: "3584000004",
      bloodType: "O-",
      address: "Belgrano 731",
      joinDate: new Date("2020-01-20T00:00:00.000Z"),
    },
    emergencyContact: {
      fullName: "Paula Gomez",
      phone: "3584999004",
      relationship: "Hermana",
    },
    passwordHash,
  });

  const lucia = await upsertUser({
    id: "user_lucia_seed",
    username: "bombera_lucia",
    email: "lucia@sampacho.local",
    role: UserRole.FIREFIGHTER,
    profile: {
      fullName: "Lucia Fernandez",
      dni: "30000005",
      rank: "Bombero",
      badge: "B-202",
      phone: "3584000005",
      bloodType: "A-",
      address: "Rivadavia 622",
      joinDate: new Date("2021-04-18T00:00:00.000Z"),
    },
    emergencyContact: {
      fullName: "Raul Fernandez",
      phone: "3584999005",
      relationship: "Padre",
    },
    passwordHash,
  });

  const pablo = await upsertUser({
    id: "user_pablo_seed",
    username: "bombero_pablo",
    email: "pablo@sampacho.local",
    role: UserRole.FIREFIGHTER,
    profile: {
      fullName: "Pablo Rosales",
      dni: "30000006",
      rank: "Aspirante",
      badge: "A-301",
      phone: "3584000006",
      bloodType: "AB+",
      address: "Sarmiento 811",
      joinDate: new Date("2024-08-01T00:00:00.000Z"),
    },
    emergencyContact: {
      fullName: "Silvia Rosales",
      phone: "3584999006",
      relationship: "Madre",
    },
    passwordHash,
  });

  const sofia = await upsertUser({
    id: "user_sofia_seed",
    username: "bombera_sofia",
    email: "sofia@sampacho.local",
    role: UserRole.FIREFIGHTER,
    profile: {
      fullName: "Sofia Pereyra",
      dni: "30000007",
      rank: "Bombero",
      badge: "B-203",
      phone: "3584000007",
      bloodType: "O+",
      address: "Mitre 210",
      joinDate: new Date("2019-11-15T00:00:00.000Z"),
    },
    emergencyContact: {
      fullName: "Nicolas Pereyra",
      phone: "3584999007",
      relationship: "Hermano",
    },
    passwordHash,
  });

  await upsertUser({
    id: "user_inactive_seed",
    username: "bombero_inactivo",
    email: "inactivo@sampacho.local",
    role: UserRole.FIREFIGHTER,
    isActive: false,
    profile: {
      fullName: "Usuario Inactivo",
      dni: "30000008",
      rank: "Bombero",
      badge: "R-001",
      phone: "3584000008",
      bloodType: "B-",
      address: "Archivo 10",
      joinDate: new Date("2010-02-01T00:00:00.000Z"),
    },
    emergencyContact: {
      fullName: "Contacto Inactivo",
      phone: "3584999008",
      relationship: "Familiar",
    },
    passwordHash,
  });

  await upsertUser({
    id: "user_pending_seed",
    username: "aspirante_pendiente",
    email: "pendiente@sampacho.local",
    role: UserRole.FIREFIGHTER,
    isPendingApproval: true,
    profile: {
      fullName: "Aspirante Pendiente",
      dni: "30000009",
      rank: "Aspirante",
      badge: "P-001",
      phone: "3584000009",
      bloodType: "A+",
      address: "Solicitud 9",
      joinDate: new Date("2026-01-01T00:00:00.000Z"),
    },
    emergencyContact: {
      fullName: "Contacto Pendiente",
      phone: "3584999009",
      relationship: "Madre",
    },
    passwordHash,
  });

  const activeUsers = [admin, operator, chief, martin, lucia, pablo, sofia];

  await repairLegacyRanks();

  await prisma.volunteerApplication.upsert({
    where: { id: "application_pending_seed" },
    update: {
      status: ApplicationStatus.PENDING,
      reviewedByUserId: null,
      reviewedAt: null,
      rejectReason: null,
    },
    create: {
      id: "application_pending_seed",
      desiredUsername: "nueva_aspirante",
      email: "nueva@sampacho.local",
      dni: "31000001",
      fullName: "Natalia Aspirante",
      phone: "3584111001",
      address: "Los Tilos 41",
      emergencyContactName: "Contacto Natalia",
      emergencyContactPhone: "3584888001",
      category: "Aspirante",
      message: "Quiere integrarse al cuerpo activo.",
      status: ApplicationStatus.PENDING,
    },
  });

  await prisma.volunteerApplication.upsert({
    where: { id: "application_rejected_seed" },
    update: {
      status: ApplicationStatus.REJECTED,
      reviewedByUserId: admin.id,
      reviewedAt: dateWithOffset(-8, 10, 0),
      rejectReason: "Documentacion incompleta.",
    },
    create: {
      id: "application_rejected_seed",
      desiredUsername: "rechazado_demo",
      email: "rechazado@sampacho.local",
      dni: "31000002",
      fullName: "Postulante Rechazado",
      phone: "3584111002",
      address: "Zona Rural",
      emergencyContactName: "Contacto Rechazado",
      emergencyContactPhone: "3584888002",
      category: "Aspirante",
      status: ApplicationStatus.REJECTED,
      reviewedByUserId: admin.id,
      reviewedAt: dateWithOffset(-8, 10, 0),
      rejectReason: "Documentacion incompleta.",
    },
  });

  await prisma.trustedDevice.upsert({
    where: { fingerprint: "seed-terminal-guardia" },
    update: {
      stationId: station.id,
      name: "Terminal Guardia Central",
      isActive: true,
    },
    create: {
      stationId: station.id,
      name: "Terminal Guardia Central",
      fingerprint: "seed-terminal-guardia",
      isActive: true,
    },
  });

  await prisma.qrChallenge.upsert({
    where: { id: "qr_seed_active" },
    update: {
      stationId: station.id,
      tokenHash: "seed-active-token-hash",
      expiresAt: dateWithOffset(0, 23, 59),
      revokedAt: null,
      consumedCount: 2,
      createdByUserId: operator.id,
    },
    create: {
      id: "qr_seed_active",
      stationId: station.id,
      tokenHash: "seed-active-token-hash",
      expiresAt: dateWithOffset(0, 23, 59),
      consumedCount: 2,
      createdByUserId: operator.id,
    },
  });

  await prisma.qrChallenge.upsert({
    where: { id: "qr_seed_revoked" },
    update: {
      stationId: station.id,
      tokenHash: "seed-revoked-token-hash",
      expiresAt: dateWithOffset(1, 8, 0),
      revokedAt: dateWithOffset(0, 9, 30),
      consumedCount: 0,
      createdByUserId: operator.id,
    },
    create: {
      id: "qr_seed_revoked",
      stationId: station.id,
      tokenHash: "seed-revoked-token-hash",
      expiresAt: dateWithOffset(1, 8, 0),
      revokedAt: dateWithOffset(0, 9, 30),
      consumedCount: 0,
      createdByUserId: operator.id,
    },
  });

  const existingOpenAttendances = await prisma.attendance.findMany({
    where: {
      userId: { in: activeUsers.map((user) => user.id) },
      status: AttendanceStatus.OPEN,
    },
  });

  for (const attendance of existingOpenAttendances) {
    const checkInAt = attendance.checkInAt ?? dateWithOffset(-1, 8, 0);
    const checkOutAt = new Date(checkInAt.getTime() + 60 * 60000);

    await prisma.attendance.update({
      where: { id: attendance.id },
      data: {
        status: AttendanceStatus.CLOSED,
        checkInAt,
        checkOutAt,
        workedMinutes: minutesBetween(checkInAt, checkOutAt),
        checkOutTrust: attendance.checkInTrust ?? AttendanceTrustLevel.MEDIUM,
      },
    });
  }

  const closedAttendancesToRepair = await prisma.attendance.findMany({
    where: {
      userId: { in: activeUsers.map((user) => user.id) },
      status: AttendanceStatus.CLOSED,
    },
  });

  for (const attendance of closedAttendancesToRepair) {
    const checkInAt = attendance.checkInAt ?? dateWithOffset(-7, 8, 0);
    const checkOutAt = attendance.checkOutAt ?? new Date(checkInAt.getTime() + 60 * 60000);
    const invalidWorkedTime =
      attendance.workedMinutes === null ||
      attendance.workedMinutes < 0 ||
      checkOutAt.getTime() < checkInAt.getTime();

    if (!invalidWorkedTime) continue;

    const repairedCheckOutAt =
      checkOutAt.getTime() < checkInAt.getTime()
        ? new Date(checkInAt.getTime() + 60 * 60000)
        : checkOutAt;

    await prisma.attendance.update({
      where: { id: attendance.id },
      data: {
        checkInAt,
        checkOutAt: repairedCheckOutAt,
        workedMinutes: minutesBetween(checkInAt, repairedCheckOutAt),
        checkOutTrust: attendance.checkOutTrust ?? AttendanceTrustLevel.MEDIUM,
      },
    });
  }

  const attendanceSeeds = [
    {
      id: "attendance_open_chief_seed",
      userId: chief.id,
      stationId: station.id,
      status: AttendanceStatus.OPEN,
      checkInAt: dateWithOffset(0, 7, 45),
      checkOutAt: null,
      trust: AttendanceTrustLevel.HIGH,
      device: "seed-terminal-guardia",
    },
    {
      id: "attendance_open_martin_seed",
      userId: martin.id,
      stationId: station.id,
      status: AttendanceStatus.OPEN,
      checkInAt: dateWithOffset(0, 8, 5),
      checkOutAt: null,
      trust: AttendanceTrustLevel.HIGH,
      device: "seed-terminal-guardia",
    },
    {
      id: "attendance_open_lucia_seed",
      userId: lucia.id,
      stationId: routeStation.id,
      status: AttendanceStatus.OPEN,
      checkInAt: dateWithOffset(0, 8, 20),
      checkOutAt: null,
      trust: AttendanceTrustLevel.MEDIUM,
      device: "seed-mobile-lucia",
    },
    {
      id: "attendance_closed_pablo_seed",
      userId: pablo.id,
      stationId: station.id,
      status: AttendanceStatus.CLOSED,
      checkInAt: dateWithOffset(-1, 8, 0),
      checkOutAt: dateWithOffset(-1, 20, 0),
      trust: AttendanceTrustLevel.HIGH,
      device: "seed-mobile-pablo",
    },
    {
      id: "attendance_closed_sofia_seed",
      userId: sofia.id,
      stationId: station.id,
      status: AttendanceStatus.CLOSED,
      checkInAt: dateWithOffset(-3, 20, 0),
      checkOutAt: dateWithOffset(-2, 8, 0),
      trust: AttendanceTrustLevel.HIGH,
      device: "seed-mobile-sofia",
    },
  ];

  for (const item of attendanceSeeds) {
    const workedMinutes =
      item.checkOutAt && item.checkInAt
        ? minutesBetween(item.checkInAt, item.checkOutAt)
        : null;

    await prisma.attendance.upsert({
      where: { id: item.id },
      update: {
        userId: item.userId,
        stationId: item.stationId,
        status: item.status,
        checkInAt: item.checkInAt,
        checkOutAt: item.checkOutAt,
        workedMinutes,
        checkInTrust: item.trust,
        checkOutTrust: item.checkOutAt ? item.trust : null,
        checkInDevice: item.device,
        checkOutDevice: item.checkOutAt ? item.device : null,
      },
      create: {
        id: item.id,
        userId: item.userId,
        stationId: item.stationId,
        status: item.status,
        checkInAt: item.checkInAt,
        checkOutAt: item.checkOutAt,
        workedMinutes,
        checkInTrust: item.trust,
        checkOutTrust: item.checkOutAt ? item.trust : null,
        checkInDevice: item.device,
        checkOutDevice: item.checkOutAt ? item.device : null,
      },
    });
  }

  for (const item of attendanceSeeds) {
    await prisma.attendanceRecord.upsert({
      where: { id: `${item.id}_entry` },
      update: {
        userId: item.userId,
        type: AttendanceType.ENTRY,
        method: AttendanceMethod.QR,
        recordedAt: item.checkInAt ?? dateWithOffset(0, 8, 0),
        notes: "Seed check-in",
      },
      create: {
        id: `${item.id}_entry`,
        userId: item.userId,
        type: AttendanceType.ENTRY,
        method: AttendanceMethod.QR,
        recordedAt: item.checkInAt ?? dateWithOffset(0, 8, 0),
        notes: "Seed check-in",
      },
    });

    if (item.checkOutAt) {
      await prisma.attendanceRecord.upsert({
        where: { id: `${item.id}_exit` },
        update: {
          userId: item.userId,
          type: AttendanceType.EXIT,
          method: AttendanceMethod.QR,
          recordedAt: item.checkOutAt,
          notes: "Seed check-out",
        },
        create: {
          id: `${item.id}_exit`,
          userId: item.userId,
          type: AttendanceType.EXIT,
          method: AttendanceMethod.QR,
          recordedAt: item.checkOutAt,
          notes: "Seed check-out",
        },
      });
    }
  }

  await upsertShift({
    id: "shift_today_day_seed",
    dateOffset: 0,
    startTime: "08:00",
    endTime: "20:00",
    shiftType: "Guardia diurna",
    notes: "Dotacion base para cobertura urbana.",
    createdByUserId: operator.id,
    assignedUserIds: [chief.id, martin.id, lucia.id],
  });

  await upsertShift({
    id: "shift_today_night_seed",
    dateOffset: 0,
    startTime: "20:00",
    endTime: "23:59",
    shiftType: "Refuerzo nocturno",
    notes: "Refuerzo preventivo por evento local.",
    createdByUserId: operator.id,
    assignedUserIds: [pablo.id, sofia.id],
  });

  await upsertShift({
    id: "shift_tomorrow_seed",
    dateOffset: 1,
    startTime: "08:00",
    endTime: "20:00",
    shiftType: "Guardia operativa",
    notes: "Control de equipos al inicio del turno.",
    createdByUserId: operator.id,
    assignedUserIds: [operator.id, pablo.id, sofia.id],
  });

  await upsertShift({
    id: "shift_plus_two_seed",
    dateOffset: 2,
    startTime: "08:00",
    endTime: "20:00",
    shiftType: "Guardia general",
    createdByUserId: admin.id,
    assignedUserIds: [chief.id, martin.id],
  });

  await upsertShift({
    id: "shift_plus_three_morning_seed",
    dateOffset: 3,
    startTime: "08:00",
    endTime: "12:00",
    shiftType: "Capacitacion y guardia",
    notes: "Practica de comunicaciones.",
    createdByUserId: admin.id,
    assignedUserIds: [lucia.id, pablo.id],
  });

  await upsertShift({
    id: "shift_plus_three_afternoon_seed",
    dateOffset: 3,
    startTime: "12:00",
    endTime: "20:00",
    shiftType: "Guardia de tarde",
    createdByUserId: admin.id,
    assignedUserIds: [martin.id, sofia.id],
  });

  const alertFire = await prisma.alert.upsert({
    where: { id: "alert_fire_active_seed" },
    update: {
      type: AlertType.FIRE,
      priority: AlertPriority.HIGH,
      description: "Humo visible en galpon, posible foco en deposito.",
      location: "Parque Industrial, nave 4",
      contactPhone: "3584123456",
      status: AlertStatus.ACTIVE,
      createdByUserId: operator.id,
      resolvedByUserId: null,
      resolvedAt: null,
      createdAt: dateWithOffset(0, 9, 5),
    },
    create: {
      id: "alert_fire_active_seed",
      type: AlertType.FIRE,
      priority: AlertPriority.HIGH,
      description: "Humo visible en galpon, posible foco en deposito.",
      location: "Parque Industrial, nave 4",
      contactPhone: "3584123456",
      status: AlertStatus.ACTIVE,
      createdByUserId: operator.id,
      createdAt: dateWithOffset(0, 9, 5),
    },
  });

  const alertRescue = await prisma.alert.upsert({
    where: { id: "alert_rescue_resolved_seed" },
    update: {
      type: AlertType.RESCUE,
      priority: AlertPriority.MEDIUM,
      description: "Persona asistida en zona rural.",
      location: "Camino rural norte",
      status: AlertStatus.RESOLVED,
      createdByUserId: operator.id,
      resolvedByUserId: admin.id,
      resolvedAt: dateWithOffset(-1, 18, 30),
      createdAt: dateWithOffset(-1, 17, 10),
    },
    create: {
      id: "alert_rescue_resolved_seed",
      type: AlertType.RESCUE,
      priority: AlertPriority.MEDIUM,
      description: "Persona asistida en zona rural.",
      location: "Camino rural norte",
      status: AlertStatus.RESOLVED,
      createdByUserId: operator.id,
      resolvedByUserId: admin.id,
      resolvedAt: dateWithOffset(-1, 18, 30),
      createdAt: dateWithOffset(-1, 17, 10),
    },
  });

  const alertFlood = await prisma.alert.upsert({
    where: { id: "alert_flood_active_seed" },
    update: {
      type: AlertType.FLOOD,
      priority: AlertPriority.LOW,
      description: "Acumulacion de agua en esquina, revisar desague.",
      location: "Rivadavia y Moreno",
      status: AlertStatus.ACTIVE,
      createdByUserId: admin.id,
      resolvedByUserId: null,
      resolvedAt: null,
      createdAt: dateWithOffset(0, 7, 15),
    },
    create: {
      id: "alert_flood_active_seed",
      type: AlertType.FLOOD,
      priority: AlertPriority.LOW,
      description: "Acumulacion de agua en esquina, revisar desague.",
      location: "Rivadavia y Moreno",
      status: AlertStatus.ACTIVE,
      createdByUserId: admin.id,
      createdAt: dateWithOffset(0, 7, 15),
    },
  });

  const responses = [
    {
      alertId: alertFire.id,
      userId: chief.id,
      response: AlertResponseType.GOING,
    },
    {
      alertId: alertFire.id,
      userId: martin.id,
      response: AlertResponseType.GOING,
    },
    {
      alertId: alertFire.id,
      userId: lucia.id,
      response: AlertResponseType.NOT_GOING,
    },
    {
      alertId: alertFlood.id,
      userId: sofia.id,
      response: AlertResponseType.GOING,
    },
  ];

  for (const response of responses) {
    await prisma.alertResponse.upsert({
      where: {
        alertId_userId: {
          alertId: response.alertId,
          userId: response.userId,
        },
      },
      update: {
        response: response.response,
        respondedAt: dateWithOffset(0, 9, 20),
      },
      create: {
        ...response,
        respondedAt: dateWithOffset(0, 9, 20),
      },
    });
  }

  const incident = await prisma.incident.upsert({
    where: { id: "incident_fire_open_seed" },
    update: {
      alertId: alertFire.id,
      title: "Incendio en galpon industrial",
      type: AlertType.FIRE,
      description: "Dotacion enviada para evaluacion y ataque inicial.",
      status: IncidentStatus.OPEN,
      losses: null,
      createdByUserId: operator.id,
      closedByUserId: null,
      closedAt: null,
      occurredAt: dateWithOffset(0, 9, 15),
    },
    create: {
      id: "incident_fire_open_seed",
      alertId: alertFire.id,
      title: "Incendio en galpon industrial",
      type: AlertType.FIRE,
      description: "Dotacion enviada para evaluacion y ataque inicial.",
      status: IncidentStatus.OPEN,
      createdByUserId: operator.id,
      occurredAt: dateWithOffset(0, 9, 15),
    },
  });

  const closedIncident = await prisma.incident.upsert({
    where: { id: "incident_rescue_closed_seed" },
    update: {
      alertId: alertRescue.id,
      title: "Asistencia en camino rural",
      type: AlertType.RESCUE,
      description: "Rescate cerrado sin lesionados graves.",
      status: IncidentStatus.CLOSED,
      losses: "Sin perdidas materiales.",
      createdByUserId: operator.id,
      closedByUserId: admin.id,
      closedAt: dateWithOffset(-1, 18, 35),
      occurredAt: dateWithOffset(-1, 17, 20),
    },
    create: {
      id: "incident_rescue_closed_seed",
      alertId: alertRescue.id,
      title: "Asistencia en camino rural",
      type: AlertType.RESCUE,
      description: "Rescate cerrado sin lesionados graves.",
      status: IncidentStatus.CLOSED,
      losses: "Sin perdidas materiales.",
      createdByUserId: operator.id,
      closedByUserId: admin.id,
      closedAt: dateWithOffset(-1, 18, 35),
      occurredAt: dateWithOffset(-1, 17, 20),
    },
  });

  await prisma.incidentAssignment.deleteMany({
    where: { incidentId: { in: [incident.id, closedIncident.id] } },
  });

  await prisma.incidentAssignment.createMany({
    data: [
      { incidentId: incident.id, userId: chief.id },
      { incidentId: incident.id, userId: martin.id },
      { incidentId: closedIncident.id, userId: pablo.id },
      { incidentId: closedIncident.id, userId: sofia.id },
    ],
    skipDuplicates: true,
  });

  await prisma.chatMessage.upsert({
    where: { id: "chat_seed_pinned" },
    update: {
      authorUserId: operator.id,
      body: "Revisar radios portatiles antes del cambio de guardia.",
      isPinned: true,
      deletedAt: null,
      editedAt: null,
      createdAt: dateWithOffset(0, 7, 40),
    },
    create: {
      id: "chat_seed_pinned",
      authorUserId: operator.id,
      body: "Revisar radios portatiles antes del cambio de guardia.",
      isPinned: true,
      createdAt: dateWithOffset(0, 7, 40),
    },
  });

  await prisma.chatMessage.upsert({
    where: { id: "chat_seed_martin" },
    update: {
      authorUserId: martin.id,
      body: "Movil 7 queda con tanque completo y linterna 2 en carga.",
      isPinned: false,
      deletedAt: null,
      editedAt: dateWithOffset(0, 8, 35),
      createdAt: dateWithOffset(0, 8, 10),
    },
    create: {
      id: "chat_seed_martin",
      authorUserId: martin.id,
      body: "Movil 7 queda con tanque completo y linterna 2 en carga.",
      isPinned: false,
      editedAt: dateWithOffset(0, 8, 35),
      createdAt: dateWithOffset(0, 8, 10),
    },
  });

  await prisma.chatMessage.upsert({
    where: { id: "chat_seed_deleted" },
    update: {
      authorUserId: pablo.id,
      body: "Mensaje retirado por contener informacion duplicada.",
      isPinned: false,
      deletedAt: dateWithOffset(0, 8, 50),
      editedAt: null,
      createdAt: dateWithOffset(0, 8, 45),
    },
    create: {
      id: "chat_seed_deleted",
      authorUserId: pablo.id,
      body: "Mensaje retirado por contener informacion duplicada.",
      isPinned: false,
      deletedAt: dateWithOffset(0, 8, 50),
      createdAt: dateWithOffset(0, 8, 45),
    },
  });

  const vehicleM7 = await upsertVehicle({
    assetId: "asset_movil_7_dev",
    assetName: "Movil 7 - Autobomba",
    status: AssetStatus.OPERATIONAL,
    notes: "Unidad principal de ataque.",
    unitNumber: "M7",
    plate: "AD123XY",
    year: 2018,
    mileage: 45200,
    nextOilChangeMileage: 50000,
  });

  const vehicleM12 = await upsertVehicle({
    assetId: "asset_movil_12_seed",
    assetName: "Movil 12 - Rescate",
    status: AssetStatus.MAINTENANCE,
    notes: "Unidad de rescate con mantenimiento preventivo programado.",
    unitNumber: "M12",
    plate: "AE456ZT",
    year: 2021,
    mileage: 28400,
    nextOilChangeMileage: 31000,
  });

  const ambulance = await upsertVehicle({
    assetId: "asset_ambulancia_1_seed",
    assetName: "Ambulancia 1",
    status: AssetStatus.OPERATIONAL,
    notes: "Soporte sanitario inicial.",
    unitNumber: "A1",
    plate: "AF789LS",
    year: 2020,
    mileage: 39800,
    nextOilChangeMileage: 43000,
  });

  await prisma.asset.upsert({
    where: { id: "asset_equipo_era_seed" },
    update: {
      name: "Equipo ERA reserva",
      assetType: AssetType.PPE,
      status: AssetStatus.OPERATIONAL,
      notes: "Equipo de respiracion autonoma de respaldo.",
      deletedAt: null,
    },
    create: {
      id: "asset_equipo_era_seed",
      name: "Equipo ERA reserva",
      assetType: AssetType.PPE,
      status: AssetStatus.OPERATIONAL,
      notes: "Equipo de respiracion autonoma de respaldo.",
    },
  });

  const m7Left = await upsertCompartment({
    vehicleId: vehicleM7.id,
    name: "Baulera izquierda",
    description: "Ataque y abastecimiento de agua.",
    sortOrder: 1,
  });
  const m7Right = await upsertCompartment({
    vehicleId: vehicleM7.id,
    name: "Baulera derecha",
    description: "Herramientas y senalizacion.",
    sortOrder: 2,
  });
  const m7Cabin = await upsertCompartment({
    vehicleId: vehicleM7.id,
    name: "Cabina",
    description: "Comunicaciones y documentacion.",
    sortOrder: 3,
  });
  const m12Main = await upsertCompartment({
    vehicleId: vehicleM12.id,
    name: "Modulo rescate",
    description: "Equipos hidraulicos y estabilizacion.",
    sortOrder: 1,
  });
  const ambulanceCabin = await upsertCompartment({
    vehicleId: ambulance.id,
    name: "Modulo sanitario",
    description: "Botiquin y material descartable.",
    sortOrder: 1,
  });

  const inventory = [
    await upsertInventoryItem({
      id: "item_m7_bi_1",
      compartmentId: m7Left.id,
      name: "Manguera 45mm",
      expectedQuantity: 4,
      notes: "Enrolladas y listas.",
    }),
    await upsertInventoryItem({
      id: "item_m7_bi_2",
      compartmentId: m7Left.id,
      name: "Lanza regulable",
      expectedQuantity: 2,
      notes: "Una por linea.",
    }),
    await upsertInventoryItem({
      id: "item_m7_bi_3",
      compartmentId: m7Left.id,
      name: "Llave hidrante",
      expectedQuantity: 1,
    }),
    await upsertInventoryItem({
      id: "item_m7_bd_1",
      compartmentId: m7Right.id,
      name: "Conos de seguridad",
      expectedQuantity: 6,
    }),
    await upsertInventoryItem({
      id: "item_m7_bd_2",
      compartmentId: m7Right.id,
      name: "Linterna recargable",
      expectedQuantity: 3,
      state: InventoryItemState.REVIEW,
      notes: "Una unidad con bateria baja.",
    }),
    await upsertInventoryItem({
      id: "item_m7_cab_2",
      compartmentId: m7Cabin.id,
      name: "Radio portatil",
      expectedQuantity: 3,
    }),
    await upsertInventoryItem({
      id: "item_m12_spreader_seed",
      compartmentId: m12Main.id,
      name: "Separador hidraulico",
      expectedQuantity: 1,
      state: InventoryItemState.REVIEW,
      notes: "Controlar acople.",
    }),
    await upsertInventoryItem({
      id: "item_m12_stabilizer_seed",
      compartmentId: m12Main.id,
      name: "Tacos de estabilizacion",
      expectedQuantity: 8,
    }),
    await upsertInventoryItem({
      id: "item_a1_kit_seed",
      compartmentId: ambulanceCabin.id,
      name: "Botiquin trauma",
      expectedQuantity: 1,
    }),
    await upsertInventoryItem({
      id: "item_a1_oxygen_seed",
      compartmentId: ambulanceCabin.id,
      name: "Tubo de oxigeno",
      expectedQuantity: 2,
      state: InventoryItemState.OK,
    }),
  ];

  await seedInspection({
    id: "inspection_m7_today_seed",
    vehicleId: vehicleM7.id,
    incidentType: AlertType.OTHER,
    inspectionDate: dateWithOffset(0, 8, 30),
    inspectionTime: "08:30",
    observations: "Control de inicio de guardia con una observacion menor.",
    responsibleUserIds: [chief.id, martin.id],
    items: [
      {
        inventoryItemId: inventory[0].id,
        expectedQuantity: inventory[0].expectedQuantity,
        result: InspectionItemResult.OK,
      },
      {
        inventoryItemId: inventory[1].id,
        expectedQuantity: inventory[1].expectedQuantity,
        result: InspectionItemResult.OK,
      },
      {
        inventoryItemId: inventory[2].id,
        expectedQuantity: inventory[2].expectedQuantity,
        result: InspectionItemResult.OK,
      },
      {
        inventoryItemId: inventory[3].id,
        expectedQuantity: inventory[3].expectedQuantity,
        result: InspectionItemResult.OK,
      },
      {
        inventoryItemId: inventory[4].id,
        expectedQuantity: inventory[4].expectedQuantity,
        result: InspectionItemResult.DAMAGED,
        observations: "Una linterna queda con bateria deficiente.",
      },
      {
        inventoryItemId: inventory[5].id,
        expectedQuantity: inventory[5].expectedQuantity,
        result: InspectionItemResult.OK,
      },
    ],
  });

  await seedInspection({
    id: "inspection_m12_review_seed",
    vehicleId: vehicleM12.id,
    incidentType: AlertType.ACCIDENT,
    inspectionDate: dateWithOffset(-2, 10, 15),
    inspectionTime: "10:15",
    observations: "Revision de unidad de rescate.",
    responsibleUserIds: [lucia.id, pablo.id],
    items: [
      {
        inventoryItemId: inventory[6].id,
        expectedQuantity: inventory[6].expectedQuantity,
        result: InspectionItemResult.DAMAGED,
        observations: "Acople requiere ajuste.",
      },
      {
        inventoryItemId: inventory[7].id,
        expectedQuantity: inventory[7].expectedQuantity,
        result: InspectionItemResult.OK,
      },
    ],
  });

  await seedInspection({
    id: "inspection_ambulance_today_seed",
    vehicleId: ambulance.id,
    incidentType: AlertType.MEDICAL,
    inspectionDate: dateWithOffset(0, 8, 45),
    inspectionTime: "08:45",
    observations: "Control sanitario completo sin novedades.",
    responsibleUserIds: [operator.id, sofia.id],
    items: [
      {
        inventoryItemId: inventory[8].id,
        expectedQuantity: inventory[8].expectedQuantity,
        result: InspectionItemResult.OK,
      },
      {
        inventoryItemId: inventory[9].id,
        expectedQuantity: inventory[9].expectedQuantity,
        result: InspectionItemResult.OK,
      },
    ],
  });

  await prisma.auditLog.upsert({
    where: { id: "audit_seed_loaded" },
    update: {
      actorUserId: admin.id,
      action: "SEED_LOADED",
      entityType: "System",
      entityId: "seed",
      metadata: {
        users: activeUsers.length,
        credentialNote: "shared-demo-credentials",
      },
    },
    create: {
      id: "audit_seed_loaded",
      actorUserId: admin.id,
      action: "SEED_LOADED",
      entityType: "System",
      entityId: "seed",
      metadata: {
        users: activeUsers.length,
        credentialNote: "shared-demo-credentials",
      },
    },
  });

  await prisma.auditLog.upsert({
    where: { id: "audit_seed_shift_reviewed" },
    update: {
      actorUserId: operator.id,
      action: "SHIFT_REVIEWED",
      entityType: "Shift",
      entityId: "shift_today_day_seed",
      metadata: {
        date: dateKeyWithOffset(0),
      },
    },
    create: {
      id: "audit_seed_shift_reviewed",
      actorUserId: operator.id,
      action: "SHIFT_REVIEWED",
      entityType: "Shift",
      entityId: "shift_today_day_seed",
      metadata: {
        date: dateKeyWithOffset(0),
      },
    },
  });

  console.log("Seed completo cargado.");
  console.log(`Usuarios demo: admin, operador, jefe_guardia, bombero_martin`);
  console.log(`Password demo compartida: ${DEMO_PASSWORD}`);
  console.log(
    `Dataset: ${activeUsers.length} usuarios activos, 2 estaciones, guardias, chat, asistencia, alertas, incidentes y 3 vehiculos.`,
  );
}

main()
  .catch((error) => {
    console.error("Seed error:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
