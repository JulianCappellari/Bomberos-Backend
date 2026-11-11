import { normalizeRank } from "../../utils/firefighter-ranks";
import bcrypt from "bcrypt";
import { Prisma } from "@prisma/client";
import { effectiveAccessRole } from "../../utils/firefighter-ranks";
import { prisma } from "../../config/prisma";
import { disconnectUser } from "../../config/socket";
import { serializable } from "../../utils/transaction";
import { OperationError } from "../operations/operations.schemas";
import { closeUserPermanences } from "./account-administration.service";
import { permissionAllowedForRank, SpecialPermission } from "../../utils/special-permissions";
function countAdministrators(tx: Prisma.TransactionClient) {
  return tx.user.count({ where: { isActive: true, isPendingApproval: false, deletedAt: null, OR: [{ role: "ADMIN" }, { profile: { rank: { equals: "Oficial", mode: "insensitive" } } }, { profile: { rank: { equals: "Administrador", mode: "insensitive" } } }] } });
}

function withoutPassword<T extends { passwordHash: string }>(user: T) {
  const { passwordHash: _passwordHash, ...safe } = user;
  return safe;
}

function normalizeNullable(value?: string | null) {
  if (value === undefined || value === null || value === "") return null;
  return value;
}

function toDateOrNull(value?: string | null) {
  if (!value) return null;
  return new Date(value);
}

function formatWorkedTimeHM(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;

  if (hours === 0) return `${mins} min`;
  if (mins === 0) return `${hours} h`;

  return `${hours} h ${mins} min`;
}

export async function getAllUsers() {
  const users = await prisma.user.findMany({
    where: {
      deletedAt: null,
    },
    include: {
      profile: true,
      emergencyContact: true,
      attendances: {
        where: {
          status: "CLOSED",
          discardedAt: null,
          workedMinutes: {
            not: null,
          },
        },
        select: {
          workedMinutes: true,
        },
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  return users.map((user) => {
    const totalAttendanceMinutes = user.attendances.reduce((acc, attendance) => {
      return acc + (attendance.workedMinutes ?? 0);
    }, 0);

    const { attendances, ...userWithoutAttendances } = user;

    return {
      ...withoutPassword(userWithoutAttendances),
      totalAttendanceMinutes,
      totalAttendanceFormatted: formatWorkedTimeHM(totalAttendanceMinutes),
    };
  });
}

export async function getActiveUserRoster() {
  // Listado operativo (dotaciones, asignaciones): sin la Comision Directiva (civil) ni las cuentas de guardia vinculadas.
  const rows = await prisma.user.findMany({
    where: {
      deletedAt: null,
      isActive: true,
      isPendingApproval: false,
      guardForUserId: null,
    },
    select: {
      id: true,
      username: true,
      role: true,
      profile: {
        select: {
          fullName: true,
          rank: true,
          badge: true,
          avatarUrl: true,
        },
      },
    },
    orderBy: {
      username: "asc",
    },
  });
  return rows.filter((row) => normalizeRank(row.profile?.rank) !== "comision directiva");
}

export async function getUserById(userId: string) {
  const user = await prisma.user.findFirst({
    where: {
      id: userId,
      deletedAt: null,
    },
    include: {
      profile: true,
      emergencyContact: true,
      attendances: {
        where: {
          status: "CLOSED",
          discardedAt: null,
          workedMinutes: {
            not: null,
          },
        },
        select: {
          workedMinutes: true,
        },
      },
    },
  });

  if (!user) {
    throw new Error("Usuario no encontrado");
  }

  const totalAttendanceMinutes = user.attendances.reduce((acc, attendance) => {
    return acc + (attendance.workedMinutes ?? 0);
  }, 0);

  const { attendances, ...userWithoutAttendances } = user;

  return {
    ...withoutPassword(userWithoutAttendances),
    totalAttendanceMinutes,
    totalAttendanceFormatted: formatWorkedTimeHM(totalAttendanceMinutes),
  };
}

export async function createUser(data: any, actorUserId?: string) {
  return serializable(async (prisma) => {
  const existingUsername = await prisma.user.findUnique({
    where: { username: data.username },
  });

  if (existingUsername) {
    throw new Error("Username already exists");
  }

  if (data.email) {
    const existingEmail = await prisma.user.findUnique({
      where: { email: data.email },
    });

    if (existingEmail) {
      throw new Error("Email already exists");
    }
  }

  const existingDni = await prisma.firefighterProfile.findUnique({
    where: { dni: data.dni },
  });

  if (existingDni) {
    throw new Error("DNI already exists");
  }

  const existingBadge = await prisma.firefighterProfile.findUnique({
    where: { badge: data.badge },
  });

  if (existingBadge) {
    throw new Error("Badge already exists");
  }

  const passwordHash = await bcrypt.hash(data.password, 10);

  const user = await prisma.user.create({
    data: {
      username: data.username,
      email: normalizeNullable(data.email),
      passwordHash,
      role: data.role,
      isActive: true,
      isPendingApproval: false,
      profile: {
        create: {
          fullName: data.fullName,
          dni: data.dni,
          rank: data.rank,
          badge: data.badge,
          birthDate: toDateOrNull(data.birthDate),
          phone: normalizeNullable(data.phone),
          altPhone: normalizeNullable(data.altPhone),
          address: normalizeNullable(data.address),
          bloodType: normalizeNullable(data.bloodType),
          joinDate: toDateOrNull(data.joinDate),
        },
      },
      emergencyContact: data.emergencyContact
        ? {
            create: {
              fullName: data.emergencyContact.fullName,
              phone: data.emergencyContact.phone,
              relationship: normalizeNullable(
                data.emergencyContact.relationship,
              ),
            },
          }
        : undefined,
    },
    include: {
      profile: true,
      emergencyContact: true,
    },
  });

  await prisma.auditLog.create({
    data: {
      actorUserId: actorUserId || null,
      action: "USER_CREATED",
      entityType: "User",
      entityId: user.id,
      metadata: {
        username: user.username,
        role: user.role,
      },
    },
  });

  return withoutPassword(user);
  });
}

export async function updateUser(userId: string, data: any, actorUserId?: string) {
  const updated = await serializable(async (tx) => {
  const existingUser = await tx.user.findFirst({
    where: {
      id: userId,
      deletedAt: null,
    },
    include: {
      profile: true,
      emergencyContact: true,
    },
  });

  if (!existingUser) {
    throw new Error("Usuario no encontrado");
  }
  const previousRole = effectiveAccessRole(existingUser.role, existingUser.profile?.rank);
  if (data.revision && existingUser.updatedAt.toISOString() !== data.revision) throw new OperationError(409, "El perfil cambio; recargue antes de guardar");
  const nextRole = effectiveAccessRole(data.role ?? existingUser.role, data.rank ?? existingUser.profile?.rank);
  if (actorUserId === userId && (data.isActive === false || nextRole !== previousRole)) throw new Error("No puede desactivar su cuenta ni cambiar su propio rol");
  if (previousRole === "ADMIN" && existingUser.isActive && (data.isActive === false || nextRole !== "ADMIN")) {
    const admins = await countAdministrators(tx);
    if (admins <= 1) throw new Error("Debe conservar al menos un administrador activo");
  }

  if (data.email && data.email !== existingUser.email) {
    const emailInUse = await tx.user.findUnique({
      where: { email: data.email },
    });

    if (emailInUse && emailInUse.id !== userId) {
      throw new Error("Email already exists");
    }
  }

  if (data.dni && data.dni !== existingUser.profile?.dni) {
    const dniInUse = await tx.firefighterProfile.findUnique({
      where: { dni: data.dni },
    });

    if (dniInUse && dniInUse.userId !== userId) {
      throw new Error("DNI already exists");
    }
  }

  if (data.badge && data.badge !== existingUser.profile?.badge) {
    const badgeInUse = await tx.firefighterProfile.findUnique({
      where: { badge: data.badge },
    });

    if (badgeInUse && badgeInUse.userId !== userId) {
      throw new Error("Badge already exists");
    }
  }

  const updatedUser = await tx.user.update({
    where: { id: userId },
    data: {
      updatedAt: new Date(Math.max(Date.now(), existingUser.updatedAt.getTime() + 1)),
      email: data.email !== undefined ? normalizeNullable(data.email) : undefined,
      role: data.role,
      isActive: data.isActive,
      guardEligible: data.rank !== undefined && data.rank !== existingUser.profile?.rank ? false : undefined,
      financeChief: data.rank !== undefined && data.rank !== existingUser.profile?.rank ? false : undefined,
      specialPermissions: data.rank !== undefined && data.rank !== existingUser.profile?.rank ? existingUser.specialPermissions.filter((permission) => permissionAllowedForRank(permission as SpecialPermission, data.rank)) : undefined,
      profile: existingUser.profile
        ? {
            update: {
              fullName: data.fullName,
              dni: data.dni,
              rank: data.rank,
              // 14: el cambio de cargo registra la fecha del ascenso para calcular la antiguedad en el cargo.
              rankSince: data.rank !== undefined && data.rank !== existingUser.profile?.rank ? new Date() : undefined,
              badge: data.badge,
              birthDate:
                data.birthDate !== undefined
                  ? toDateOrNull(data.birthDate)
                  : undefined,
              phone:
                data.phone !== undefined
                  ? normalizeNullable(data.phone)
                  : undefined,
              altPhone:
                data.altPhone !== undefined
                  ? normalizeNullable(data.altPhone)
                  : undefined,
              address:
                data.address !== undefined
                  ? normalizeNullable(data.address)
                  : undefined,
              bloodType:
                data.bloodType !== undefined
                  ? normalizeNullable(data.bloodType)
                  : undefined,
              joinDate:
                data.joinDate !== undefined
                  ? toDateOrNull(data.joinDate)
                  : undefined,
            },
          }
        : undefined,
      emergencyContact: data.emergencyContact
        ? existingUser.emergencyContact
          ? {
              update: {
                fullName: data.emergencyContact.fullName,
                phone: data.emergencyContact.phone,
                relationship: normalizeNullable(
                  data.emergencyContact.relationship,
                ),
              },
            }
          : {
              create: {
                fullName: data.emergencyContact.fullName,
                phone: data.emergencyContact.phone,
                relationship: normalizeNullable(
                  data.emergencyContact.relationship,
                ),
              },
            }
        : undefined,
    },
    include: {
      profile: true,
      emergencyContact: true,
    },
  });

  await tx.auditLog.create({
    data: {
      actorUserId: actorUserId || null,
      action: "USER_UPDATED",
      entityType: "User",
      entityId: updatedUser.id,
      metadata: {
        username: updatedUser.username,
        previousRole,
        nextRole,
        previousRank: existingUser.profile?.rank || null,
        nextRank: updatedUser.profile?.rank || null,
        changes: Object.keys(data).filter((key) => key !== "revision").map((field) => ({ field, before: JSON.parse(JSON.stringify((existingUser as any)[field] ?? (existingUser.profile as any)?.[field] ?? null)), after: JSON.parse(JSON.stringify((updatedUser as any)[field] ?? (updatedUser.profile as any)?.[field] ?? null)) })),
      },
    },
  });

  if (existingUser.guardEligible && !updatedUser.guardEligible) {
    await tx.authSession.updateMany({where:{userId,guardMode:true},data:{guardMode:false}});
    await tx.auditLog.create({data:{actorUserId:actorUserId||null,action:"GUARD_FUNCTION_REVOKED",entityType:"User",entityId:userId,metadata:{reason:"Cambio de cargo institucional"}}});
  }
  if (existingUser.specialPermissions.length !== updatedUser.specialPermissions.length) await tx.auditLog.create({data:{actorUserId:actorUserId||null,action:"SPECIAL_PERMISSION_REVOKED",entityType:"User",entityId:userId,metadata:{before:existingUser.specialPermissions,after:updatedUser.specialPermissions,reason:"Cambio de cargo institucional"}}});
  if(existingUser.financeChief&&!updatedUser.financeChief)await tx.auditLog.create({data:{actorUserId:actorUserId||null,action:"FINANCE_CHIEF_CHANGED",entityType:"User",entityId:userId,metadata:{before:true,after:false,reason:"Cambio de cargo institucional"}}});
  if (nextRole !== previousRole || data.role !== undefined && data.role !== existingUser.role || data.isActive === false) {
    if (data.isActive === false) await closeUserPermanences(tx, userId, actorUserId || null, "Cuenta suspendida por administracion");
    await tx.authSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  }
  return withoutPassword(updatedUser);
  });
  disconnectUser(userId);
  return updated;
}

export async function toggleUserActive(userId: string, actorUserId?: string) {
  const updated = await serializable(async (tx) => {
  const user = await tx.user.findFirst({
    where: {
      id: userId,
      deletedAt: null,
    },
    include: { profile: true },
  });

  if (!user) {
    throw new Error("Usuario no encontrado");
  }
  if (actorUserId === userId && user.isActive) throw new Error("No puede desactivar su propia cuenta");
  if (effectiveAccessRole(user.role, user.profile?.rank) === "ADMIN" && user.isActive && await countAdministrators(tx) <= 1) throw new Error("Debe conservar al menos un administrador activo");

  const updatedUser = await tx.user.update({
    where: { id: userId },
    data: {
      isActive: !user.isActive,
    },
    include: {
      profile: true,
      emergencyContact: true,
    },
  });

  await tx.auditLog.create({
    data: {
      actorUserId: actorUserId || null,
      action: updatedUser.isActive ? "USER_ACTIVATED" : "USER_DEACTIVATED",
      entityType: "User",
      entityId: updatedUser.id,
      metadata: {
        username: updatedUser.username,
        isActive: updatedUser.isActive,
      },
    },
  });

  if (!updatedUser.isActive) {
    await closeUserPermanences(tx, userId, actorUserId || null, "Cuenta suspendida por administracion");
    await tx.authSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  }
  return withoutPassword(updatedUser);
  });
  if (!updated.isActive) disconnectUser(userId);
  return updated;
}
