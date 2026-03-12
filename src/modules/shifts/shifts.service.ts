import { prisma } from "../../config/prisma";

function normalizeNullable(value?: string | null) {
  if (value === undefined || value === null || value === "") return null;
  return value;
}

function toDateOnly(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

async function ensureUsersExist(userIds: string[]) {
  if (!userIds.length) return;

  const users = await prisma.user.findMany({
    where: {
      id: { in: userIds },
      deletedAt: null,
      isActive: true,
    },
    select: { id: true },
  });

  const foundIds = new Set(users.map((u) => u.id));
  const missing = userIds.filter((id) => !foundIds.has(id));

  if (missing.length > 0) {
    throw new Error(`Some users do not exist or are inactive: ${missing.join(", ")}`);
  }
}

export async function createShift(data: {
  date: string;
  startTime: string;
  endTime: string;
  shiftType: string;
  notes?: string | null;
  assignedUserIds?: string[];
  createdByUserId: string;
}) {
  await ensureUsersExist(data.assignedUserIds || []);

  const shift = await prisma.shift.create({
    data: {
      date: toDateOnly(data.date),
      startTime: data.startTime,
      endTime: data.endTime,
      shiftType: data.shiftType,
      notes: normalizeNullable(data.notes),
      createdByUserId: data.createdByUserId,
      assignments: data.assignedUserIds?.length
        ? {
            create: data.assignedUserIds.map((userId) => ({
              userId,
            })),
          }
        : undefined,
    },
    include: {
      createdBy: {
        include: {
          profile: true,
        },
      },
      assignments: {
        include: {
          user: {
            include: {
              profile: true,
            },
          },
        },
      },
    },
  });

  await prisma.auditLog.create({
    data: {
      actorUserId: data.createdByUserId,
      action: "SHIFT_CREATED",
      entityType: "Shift",
      entityId: shift.id,
      metadata: {
        date: data.date,
        startTime: data.startTime,
        endTime: data.endTime,
        shiftType: data.shiftType,
      },
    },
  });

  return shift;
}

export async function getAllShifts(date?: string) {
  return prisma.shift.findMany({
    where: date
      ? {
          date: toDateOnly(date),
        }
      : undefined,
    include: {
      createdBy: {
        include: {
          profile: true,
        },
      },
      assignments: {
        include: {
          user: {
            include: {
              profile: true,
            },
          },
        },
      },
    },
    orderBy: [
      { date: "asc" },
      { startTime: "asc" },
    ],
  });
}

export async function getShiftById(shiftId: string) {
  const shift = await prisma.shift.findUnique({
    where: { id: shiftId },
    include: {
      createdBy: {
        include: {
          profile: true,
        },
      },
      assignments: {
        include: {
          user: {
            include: {
              profile: true,
            },
          },
        },
      },
    },
  });

  if (!shift) {
    throw new Error("Shift not found");
  }

  return shift;
}

export async function assignUsersToShift(
  shiftId: string,
  userIds: string[],
  actorUserId?: string,
) {
  const shift = await prisma.shift.findUnique({
    where: { id: shiftId },
  });

  if (!shift) {
    throw new Error("Shift not found");
  }

  await ensureUsersExist(userIds);

  const existingAssignments = await prisma.shiftAssignment.findMany({
    where: {
      shiftId,
      userId: { in: userIds },
    },
    select: { userId: true },
  });

  const existingUserIds = new Set(existingAssignments.map((a) => a.userId));
  const newUserIds = userIds.filter((id) => !existingUserIds.has(id));

  if (newUserIds.length > 0) {
    await prisma.shiftAssignment.createMany({
      data: newUserIds.map((userId) => ({
        shiftId,
        userId,
      })),
    });
  }

  await prisma.auditLog.create({
    data: {
      actorUserId: actorUserId || null,
      action: "SHIFT_USERS_ASSIGNED",
      entityType: "Shift",
      entityId: shiftId,
      metadata: {
        assignedUserIds: userIds,
      },
    },
  });

  return getShiftById(shiftId);
}

export async function deleteShift(shiftId: string, actorUserId?: string) {
  const shift = await prisma.shift.findUnique({
    where: { id: shiftId },
  });

  if (!shift) {
    throw new Error("Shift not found");
  }

  await prisma.shift.delete({
    where: { id: shiftId },
  });

  await prisma.auditLog.create({
    data: {
      actorUserId: actorUserId || null,
      action: "SHIFT_DELETED",
      entityType: "Shift",
      entityId: shiftId,
      metadata: {
        shiftType: shift.shiftType,
        date: shift.date,
      },
    },
  });

  return { message: "Shift deleted successfully" };
}