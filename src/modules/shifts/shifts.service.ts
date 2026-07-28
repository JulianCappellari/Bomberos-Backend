import { prisma } from "../../config/prisma";

function normalizeNullable(value?: string | null) {
  if (value === undefined || value === null || value === "") return null;
  return value;
}

function toDateOnly(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

function toDateEnd(value: string) {
  return new Date(`${value}T23:59:59.999Z`);
}

function toDateKey(value: Date) {
  return value.toISOString().slice(0, 10);
}

function timeToMinutes(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function timeRangesOverlap(
  startA: string,
  endA: string,
  startB: string,
  endB: string,
) {
  return timeToMinutes(startA) < timeToMinutes(endB) &&
    timeToMinutes(startB) < timeToMinutes(endA);
}

function uniqueUserIds(userIds: string[]) {
  return Array.from(new Set(userIds));
}

async function ensureUsersExist(userIds: string[]) {
  if (!userIds.length) return;

  const users = await prisma.user.findMany({
    where: {
      id: { in: userIds },
      deletedAt: null,
      isActive: true,
      isPendingApproval: false,
    },
    select: { id: true },
  });

  const foundIds = new Set(users.map((u) => u.id));
  const missing = userIds.filter((id) => !foundIds.has(id));

  if (missing.length > 0) {
    throw new Error(`Some users do not exist or are inactive: ${missing.join(", ")}`);
  }
}

async function ensureNoOverlappingAssignments(data: {
  date: string;
  startTime: string;
  endTime: string;
  userIds: string[];
  excludeShiftId?: string;
}) {
  if (!data.userIds.length) return;

  const shifts = await prisma.shift.findMany({
    where: {
      date: toDateOnly(data.date),
      ...(data.excludeShiftId ? { id: { not: data.excludeShiftId } } : {}),
      assignments: {
        some: {
          userId: {
            in: data.userIds,
          },
        },
      },
    },
    include: {
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

  const conflicts = shifts.flatMap((shift) => {
    if (
      !timeRangesOverlap(
        data.startTime,
        data.endTime,
        shift.startTime,
        shift.endTime,
      )
    ) {
      return [];
    }

    return shift.assignments
      .filter((assignment) => data.userIds.includes(assignment.userId))
      .map((assignment) => ({
        name:
          assignment.user.profile?.fullName ||
          assignment.user.username ||
          assignment.userId,
        shiftType: shift.shiftType,
        startTime: shift.startTime,
        endTime: shift.endTime,
      }));
  });

  if (conflicts.length > 0) {
    const conflict = conflicts[0];
    throw new Error(
      `${conflict.name} ya tiene guardia ${conflict.shiftType} de ${conflict.startTime} a ${conflict.endTime}`,
    );
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
  const assignedUserIds = uniqueUserIds(data.assignedUserIds || []);

  if (timeToMinutes(data.endTime) <= timeToMinutes(data.startTime)) {
    throw new Error("La hora de fin debe ser posterior a la hora de inicio");
  }

  await ensureUsersExist(assignedUserIds);
  await ensureNoOverlappingAssignments({
    date: data.date,
    startTime: data.startTime,
    endTime: data.endTime,
    userIds: assignedUserIds,
  });

  const shift = await prisma.shift.create({
    data: {
      date: toDateOnly(data.date),
      startTime: data.startTime,
      endTime: data.endTime,
      shiftType: data.shiftType,
      notes: normalizeNullable(data.notes),
      createdByUserId: data.createdByUserId,
      assignments: assignedUserIds.length
        ? {
            create: assignedUserIds.map((userId) => ({
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

export async function getAllShifts(filters?: {
  date?: string;
  from?: string;
  to?: string;
}) {
  const where = filters?.date
    ? {
        date: toDateOnly(filters.date),
      }
    : filters?.from || filters?.to
      ? {
          date: {
            ...(filters.from ? { gte: toDateOnly(filters.from) } : {}),
            ...(filters.to ? { lte: toDateEnd(filters.to) } : {}),
          },
        }
      : undefined;

  return prisma.shift.findMany({
    where,
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

  const uniqueIds = uniqueUserIds(userIds);

  await ensureUsersExist(uniqueIds);
  await ensureNoOverlappingAssignments({
    date: toDateKey(shift.date),
    startTime: shift.startTime,
    endTime: shift.endTime,
    userIds: uniqueIds,
    excludeShiftId: shiftId,
  });

  const existingAssignments = await prisma.shiftAssignment.findMany({
    where: {
      shiftId,
      userId: { in: uniqueIds },
    },
    select: { userId: true },
  });

  const existingUserIds = new Set(existingAssignments.map((a) => a.userId));
  const newUserIds = uniqueIds.filter((id) => !existingUserIds.has(id));

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
        assignedUserIds: uniqueIds,
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
