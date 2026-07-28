"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createShift = createShift;
exports.getAllShifts = getAllShifts;
exports.getShiftById = getShiftById;
exports.assignUsersToShift = assignUsersToShift;
exports.deleteShift = deleteShift;
const prisma_1 = require("../../config/prisma");
function normalizeNullable(value) {
    if (value === undefined || value === null || value === "")
        return null;
    return value;
}
function toDateOnly(value) {
    return new Date(`${value}T00:00:00.000Z`);
}
function toDateEnd(value) {
    return new Date(`${value}T23:59:59.999Z`);
}
function toDateKey(value) {
    return value.toISOString().slice(0, 10);
}
function timeToMinutes(value) {
    const [hours, minutes] = value.split(":").map(Number);
    return hours * 60 + minutes;
}
function timeRangesOverlap(startA, endA, startB, endB) {
    return timeToMinutes(startA) < timeToMinutes(endB) &&
        timeToMinutes(startB) < timeToMinutes(endA);
}
function uniqueUserIds(userIds) {
    return Array.from(new Set(userIds));
}
async function ensureUsersExist(userIds) {
    if (!userIds.length)
        return;
    const users = await prisma_1.prisma.user.findMany({
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
async function ensureNoOverlappingAssignments(data) {
    if (!data.userIds.length)
        return;
    const shifts = await prisma_1.prisma.shift.findMany({
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
        if (!timeRangesOverlap(data.startTime, data.endTime, shift.startTime, shift.endTime)) {
            return [];
        }
        return shift.assignments
            .filter((assignment) => data.userIds.includes(assignment.userId))
            .map((assignment) => ({
            name: assignment.user.profile?.fullName ||
                assignment.user.username ||
                assignment.userId,
            shiftType: shift.shiftType,
            startTime: shift.startTime,
            endTime: shift.endTime,
        }));
    });
    if (conflicts.length > 0) {
        const conflict = conflicts[0];
        throw new Error(`${conflict.name} ya tiene guardia ${conflict.shiftType} de ${conflict.startTime} a ${conflict.endTime}`);
    }
}
async function createShift(data) {
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
    const shift = await prisma_1.prisma.shift.create({
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
    await prisma_1.prisma.auditLog.create({
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
async function getAllShifts(filters) {
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
    return prisma_1.prisma.shift.findMany({
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
async function getShiftById(shiftId) {
    const shift = await prisma_1.prisma.shift.findUnique({
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
async function assignUsersToShift(shiftId, userIds, actorUserId) {
    const shift = await prisma_1.prisma.shift.findUnique({
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
    const existingAssignments = await prisma_1.prisma.shiftAssignment.findMany({
        where: {
            shiftId,
            userId: { in: uniqueIds },
        },
        select: { userId: true },
    });
    const existingUserIds = new Set(existingAssignments.map((a) => a.userId));
    const newUserIds = uniqueIds.filter((id) => !existingUserIds.has(id));
    if (newUserIds.length > 0) {
        await prisma_1.prisma.shiftAssignment.createMany({
            data: newUserIds.map((userId) => ({
                shiftId,
                userId,
            })),
        });
    }
    await prisma_1.prisma.auditLog.create({
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
async function deleteShift(shiftId, actorUserId) {
    const shift = await prisma_1.prisma.shift.findUnique({
        where: { id: shiftId },
    });
    if (!shift) {
        throw new Error("Shift not found");
    }
    await prisma_1.prisma.shift.delete({
        where: { id: shiftId },
    });
    await prisma_1.prisma.auditLog.create({
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
