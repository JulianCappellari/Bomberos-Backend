import { Prisma } from "@prisma/client";

// Operational screens only need identity and institutional rank.
export const PUBLIC_USER_SELECT = {
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
} as const satisfies Prisma.UserSelect;
