import bcrypt from "bcrypt";
import { prisma } from "../../config/prisma";
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from "../../utils/jwt";
import { LoginResponse, SafeUser } from "./auth.types";

function mapSafeUser(user: any): SafeUser {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role,
    isActive: user.isActive,
    isPendingApproval: user.isPendingApproval,
    profile: user.profile
      ? {
          fullName: user.profile.fullName,
          rank: user.profile.rank,
          badge: user.profile.badge,
        }
      : null,
  };
}

export async function loginUser(
  username: string,
  password: string,
): Promise<LoginResponse> {
  const user = await prisma.user.findUnique({
    where: { username },
    include: { profile: true },
  });

  if (!user) {
    throw new Error("Invalid credentials");
  }

  if (!user.isActive) {
    throw new Error("Account is inactive");
  }

  if (user.isPendingApproval) {
    throw new Error("Account pending approval");
  }

  const passwordMatches = await bcrypt.compare(password, user.passwordHash);

  if (!passwordMatches) {
    throw new Error("Invalid credentials");
  }

  const payload = {
    userId: user.id,
    role: user.role,
  };

  const accessToken = signAccessToken(payload);
  const refreshToken = signRefreshToken(payload);

  return {
    user: mapSafeUser(user),
    tokens: {
      accessToken,
      refreshToken,
    },
  };
}

export async function refreshUserToken(refreshToken: string) {
  const payload = verifyRefreshToken(refreshToken);

  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    include: { profile: true },
  });

  if (!user) {
    throw new Error("User not found");
  }

  if (!user.isActive || user.isPendingApproval) {
    throw new Error("User is not allowed to access");
  }

  const newAccessToken = signAccessToken({
    userId: user.id,
    role: user.role,
  });

  return {
    accessToken: newAccessToken,
  };
}

export async function changeUserPassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
  });

  if (!user) {
    throw new Error("User not found");
  }

  const passwordMatches = await bcrypt.compare(
    currentPassword,
    user.passwordHash,
  );

  if (!passwordMatches) {
    throw new Error("Current password is incorrect");
  }

  const newPasswordHash = await bcrypt.hash(newPassword, 10);

  await prisma.user.update({
    where: { id: userId },
    data: {
      passwordHash: newPasswordHash,
    },
  });

  return {
    message: "Password updated successfully",
  };
}