"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.operationalStatus = operationalStatus;
exports.operationalAvailability = operationalAvailability;
const prisma_1 = require("../../config/prisma");
const public_user_1 = require("../../utils/public-user");
const firefighter_ranks_1 = require("../../utils/firefighter-ranks");
function operationalStatus(deployed, present, unavailable, confirmed) {
    return deployed ? "DEPLOYED" : present ? "PRESENT" : unavailable ? "UNAVAILABLE" : confirmed ? "AVAILABLE" : "UNKNOWN";
}
async function operationalAvailability() {
    const now = new Date();
    const people = await prisma_1.prisma.user.findMany({ where: { isActive: true, isPendingApproval: false, deletedAt: null }, select: {
            ...public_user_1.PUBLIC_USER_SELECT, emergencyStatusConfirmedAt: true,
            attendances: { where: { status: "OPEN", checkInAt: { lte: now }, checkInQrId: { not: null }, checkInTrust: { not: "REJECTED" } }, select: { id: true }, take: 1 },
            missionCrew: { where: { movement: { returnedAt: null } }, select: { userId: true }, take: 1 },
            emergencyAvailability: { where: { cancelledAt: null, startsAt: { lte: now }, OR: [{ endsAt: null }, { endsAt: { gt: now } }] }, select: { id: true }, take: 1 },
        }, orderBy: { username: "asc" } });
    return { generatedAt: now, people: people.filter(p => (0, firefighter_ranks_1.normalizeRank)(p.profile?.rank) !== "administrador").map(({ attendances, missionCrew, emergencyAvailability, emergencyStatusConfirmedAt, ...person }) => ({
            ...person, status: operationalStatus(Boolean(missionCrew.length), Boolean(attendances.length), Boolean(emergencyAvailability.length), Boolean(emergencyStatusConfirmedAt)),
        })) };
}
