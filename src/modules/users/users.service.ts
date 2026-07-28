import bcrypt from "bcrypt";
import { prisma } from "../../config/prisma";

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
      ...userWithoutAttendances,
      totalAttendanceMinutes,
      totalAttendanceFormatted: formatWorkedTimeHM(totalAttendanceMinutes),
    };
  });
}

export async function getActiveUserRoster() {
  return prisma.user.findMany({
    where: {
      deletedAt: null,
      isActive: true,
      isPendingApproval: false,
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
    throw new Error("User not found");
  }

  const totalAttendanceMinutes = user.attendances.reduce((acc, attendance) => {
    return acc + (attendance.workedMinutes ?? 0);
  }, 0);

  const { attendances, ...userWithoutAttendances } = user;

  return {
    ...userWithoutAttendances,
    totalAttendanceMinutes,
    totalAttendanceFormatted: formatWorkedTimeHM(totalAttendanceMinutes),
  };
}

export async function createUser(data: any, actorUserId?: string) {
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

  return user;
}

export async function updateUser(userId: string, data: any, actorUserId?: string) {
  const existingUser = await prisma.user.findFirst({
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
    throw new Error("User not found");
  }

  if (data.email && data.email !== existingUser.email) {
    const emailInUse = await prisma.user.findUnique({
      where: { email: data.email },
    });

    if (emailInUse && emailInUse.id !== userId) {
      throw new Error("Email already exists");
    }
  }

  if (data.dni && data.dni !== existingUser.profile?.dni) {
    const dniInUse = await prisma.firefighterProfile.findUnique({
      where: { dni: data.dni },
    });

    if (dniInUse && dniInUse.userId !== userId) {
      throw new Error("DNI already exists");
    }
  }

  if (data.badge && data.badge !== existingUser.profile?.badge) {
    const badgeInUse = await prisma.firefighterProfile.findUnique({
      where: { badge: data.badge },
    });

    if (badgeInUse && badgeInUse.userId !== userId) {
      throw new Error("Badge already exists");
    }
  }

  const updatedUser = await prisma.user.update({
    where: { id: userId },
    data: {
      email: data.email !== undefined ? normalizeNullable(data.email) : undefined,
      role: data.role,
      isActive: data.isActive,
      profile: existingUser.profile
        ? {
            update: {
              fullName: data.fullName,
              dni: data.dni,
              rank: data.rank,
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

  await prisma.auditLog.create({
    data: {
      actorUserId: actorUserId || null,
      action: "USER_UPDATED",
      entityType: "User",
      entityId: updatedUser.id,
      metadata: {
        username: updatedUser.username,
      },
    },
  });

  return updatedUser;
}

export async function toggleUserActive(userId: string, actorUserId?: string) {
  const user = await prisma.user.findFirst({
    where: {
      id: userId,
      deletedAt: null,
    },
  });

  if (!user) {
    throw new Error("User not found");
  }

  const updatedUser = await prisma.user.update({
    where: { id: userId },
    data: {
      isActive: !user.isActive,
    },
    include: {
      profile: true,
      emergencyContact: true,
    },
  });

  await prisma.auditLog.create({
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

  return updatedUser;
}
