"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createApplication = createApplication;
exports.getAllApplications = getAllApplications;
exports.getApplicationById = getApplicationById;
exports.approveApplication = approveApplication;
exports.rejectApplication = rejectApplication;
const bcrypt_1 = __importDefault(require("bcrypt"));
const node_crypto_1 = require("node:crypto");
const prisma_1 = require("../../config/prisma");
const transaction_1 = require("../../utils/transaction");
function normalizeNullable(value) {
    if (value === undefined || value === null || value === "")
        return null;
    return value;
}
function toDateOrNull(value) {
    if (!value)
        return null;
    return new Date(value);
}
async function createApplication(data) {
    return (0, transaction_1.serializable)(async (tx) => {
        const usernameInUsers = await tx.user.findUnique({
            where: { username: data.desiredUsername },
        });
        if (usernameInUsers) {
            throw new Error("Username already exists");
        }
        const pendingSameUsername = await tx.volunteerApplication.findFirst({
            where: {
                desiredUsername: data.desiredUsername,
                status: "PENDING",
            },
        });
        if (pendingSameUsername) {
            throw new Error("There is already a pending application with that username");
        }
        const dniInProfiles = await tx.firefighterProfile.findUnique({
            where: { dni: data.dni },
        });
        if (dniInProfiles) {
            throw new Error("DNI already exists");
        }
        const pendingSameDni = await tx.volunteerApplication.findFirst({
            where: {
                dni: data.dni,
                status: "PENDING",
            },
        });
        if (pendingSameDni) {
            throw new Error("There is already a pending application with that DNI");
        }
        const application = await tx.volunteerApplication.create({
            data: {
                desiredUsername: data.desiredUsername,
                email: normalizeNullable(data.email),
                dni: data.dni,
                fullName: data.fullName,
                birthDate: toDateOrNull(data.birthDate),
                phone: data.phone,
                altPhone: normalizeNullable(data.altPhone),
                address: data.address,
                bloodType: normalizeNullable(data.bloodType),
                emergencyContactName: data.emergencyContactName,
                emergencyContactPhone: data.emergencyContactPhone,
                emergencyContactRelation: normalizeNullable(data.emergencyContactRelation),
                category: normalizeNullable(data.category),
                message: normalizeNullable(data.message),
                status: "PENDING",
            },
        });
        return application;
    });
}
async function getAllApplications(status) {
    return prisma_1.prisma.volunteerApplication.findMany({
        where: status
            ? {
                status: status,
            }
            : undefined,
        orderBy: {
            createdAt: "desc",
        },
    });
}
async function getApplicationById(applicationId) {
    const application = await prisma_1.prisma.volunteerApplication.findUnique({
        where: { id: applicationId },
    });
    if (!application) {
        throw new Error("Application not found");
    }
    return application;
}
async function approveApplication(applicationId, actorUserId) {
    const initialPassword = (0, node_crypto_1.randomBytes)(24).toString("base64url");
    const passwordHash = await bcrypt_1.default.hash(initialPassword, 12);
    return (0, transaction_1.serializable)(async (tx) => {
        const application = await tx.volunteerApplication.findUnique({
            where: { id: applicationId },
        });
        if (!application) {
            throw new Error("Application not found");
        }
        if (application.status !== "PENDING") {
            throw new Error("Only pending applications can be approved");
        }
        const usernameInUsers = await tx.user.findUnique({
            where: { username: application.desiredUsername },
        });
        if (usernameInUsers) {
            throw new Error("Username already exists in users");
        }
        const dniInProfiles = await tx.firefighterProfile.findUnique({
            where: { dni: application.dni },
        });
        if (dniInProfiles) {
            throw new Error("DNI already exists in profiles");
        }
        const user = await tx.user.create({
            data: {
                username: application.desiredUsername,
                email: application.email,
                passwordHash,
                mustChangePassword: true,
                role: "FIREFIGHTER",
                isActive: true,
                isPendingApproval: false,
                profile: {
                    create: {
                        fullName: application.fullName,
                        dni: application.dni,
                        birthDate: application.birthDate,
                        rank: "Aspirante",
                        badge: `B-${(0, node_crypto_1.randomUUID)().slice(0, 20)}`,
                        phone: application.phone,
                        altPhone: application.altPhone,
                        address: application.address,
                        bloodType: application.bloodType,
                        joinDate: new Date(),
                    },
                },
                emergencyContact: {
                    create: {
                        fullName: application.emergencyContactName,
                        phone: application.emergencyContactPhone,
                        relationship: application.emergencyContactRelation,
                    },
                },
            },
            include: {
                profile: true,
                emergencyContact: true,
            },
        });
        const updatedApplication = await tx.volunteerApplication.update({
            where: { id: applicationId },
            data: {
                status: "APPROVED",
                reviewedByUserId: actorUserId,
                reviewedAt: new Date(),
                submittedByUserId: user.id,
            },
        });
        await tx.auditLog.create({
            data: {
                actorUserId,
                action: "APPLICATION_APPROVED",
                entityType: "VolunteerApplication",
                entityId: applicationId,
                metadata: {
                    desiredUsername: application.desiredUsername,
                    createdUserId: user.id,
                },
            },
        });
        return {
            application: updatedApplication,
            user: { id: user.id, username: user.username },
            initialPassword,
        };
    });
}
async function rejectApplication(applicationId, actorUserId, rejectReason) {
    return (0, transaction_1.serializable)(async (tx) => {
        const application = await tx.volunteerApplication.findUnique({
            where: { id: applicationId },
        });
        if (!application) {
            throw new Error("Application not found");
        }
        if (application.status !== "PENDING") {
            throw new Error("Only pending applications can be rejected");
        }
        const updatedApplication = await tx.volunteerApplication.update({
            where: { id: applicationId },
            data: {
                status: "REJECTED",
                reviewedByUserId: actorUserId,
                reviewedAt: new Date(),
                rejectReason: normalizeNullable(rejectReason),
            },
        });
        await tx.auditLog.create({
            data: {
                actorUserId,
                action: "APPLICATION_REJECTED",
                entityType: "VolunteerApplication",
                entityId: applicationId,
                metadata: {
                    desiredUsername: application.desiredUsername,
                    rejectReason: normalizeNullable(rejectReason),
                },
            },
        });
        return updatedApplication;
    });
}
