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

export async function createApplication(data: any) {
  const usernameInUsers = await prisma.user.findUnique({
    where: { username: data.desiredUsername },
  });

  if (usernameInUsers) {
    throw new Error("Username already exists");
  }

  const pendingSameUsername = await prisma.volunteerApplication.findFirst({
    where: {
      desiredUsername: data.desiredUsername,
      status: "PENDING",
    },
  });

  if (pendingSameUsername) {
    throw new Error("There is already a pending application with that username");
  }

  const dniInProfiles = await prisma.firefighterProfile.findUnique({
    where: { dni: data.dni },
  });

  if (dniInProfiles) {
    throw new Error("DNI already exists");
  }

  const pendingSameDni = await prisma.volunteerApplication.findFirst({
    where: {
      dni: data.dni,
      status: "PENDING",
    },
  });

  if (pendingSameDni) {
    throw new Error("There is already a pending application with that DNI");
  }

  const application = await prisma.volunteerApplication.create({
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
}

export async function getAllApplications(status?: string) {
  return prisma.volunteerApplication.findMany({
    where: status
      ? {
          status: status as "PENDING" | "APPROVED" | "REJECTED",
        }
      : undefined,
    orderBy: {
      createdAt: "desc",
    },
  });
}

export async function getApplicationById(applicationId: string) {
  const application = await prisma.volunteerApplication.findUnique({
    where: { id: applicationId },
  });

  if (!application) {
    throw new Error("Application not found");
  }

  return application;
}

export async function approveApplication(applicationId: string, actorUserId: string) {
  const application = await prisma.volunteerApplication.findUnique({
    where: { id: applicationId },
  });

  if (!application) {
    throw new Error("Application not found");
  }

  if (application.status !== "PENDING") {
    throw new Error("Only pending applications can be approved");
  }

  const usernameInUsers = await prisma.user.findUnique({
    where: { username: application.desiredUsername },
  });

  if (usernameInUsers) {
    throw new Error("Username already exists in users");
  }

  const dniInProfiles = await prisma.firefighterProfile.findUnique({
    where: { dni: application.dni },
  });

  if (dniInProfiles) {
    throw new Error("DNI already exists in profiles");
  }

  const passwordHash = await bcrypt.hash(application.dni, 10);

  const userCount = await prisma.user.count();

  const user = await prisma.user.create({
    data: {
      username: application.desiredUsername,
      email: application.email,
      passwordHash,
      role: "FIREFIGHTER",
      isActive: true,
      isPendingApproval: false,
      profile: {
        create: {
          fullName: application.fullName,
          dni: application.dni,
          birthDate: application.birthDate,
          rank: "Aspirante",
          badge: `B-${String(userCount + 1).padStart(3, "0")}`,
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

  const updatedApplication = await prisma.volunteerApplication.update({
    where: { id: applicationId },
    data: {
      status: "APPROVED",
      reviewedByUserId: actorUserId,
      reviewedAt: new Date(),
      submittedByUserId: user.id,
    },
  });

  await prisma.auditLog.create({
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
    user,
  };
}

export async function rejectApplication(
  applicationId: string,
  actorUserId: string,
  rejectReason?: string | null,
) {
  const application = await prisma.volunteerApplication.findUnique({
    where: { id: applicationId },
  });

  if (!application) {
    throw new Error("Application not found");
  }

  if (application.status !== "PENDING") {
    throw new Error("Only pending applications can be rejected");
  }

  const updatedApplication = await prisma.volunteerApplication.update({
    where: { id: applicationId },
    data: {
      status: "REJECTED",
      reviewedByUserId: actorUserId,
      reviewedAt: new Date(),
      rejectReason: normalizeNullable(rejectReason),
    },
  });

  await prisma.auditLog.create({
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
}
