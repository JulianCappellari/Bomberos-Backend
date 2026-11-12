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
      // Para ordenar listados: cargo, antiguedad y cursos aprobados.
      joinDate: true,
    },
  },
  _count: { select: { courses: { where: { status: "APPROVED" } } } },
} as const satisfies Prisma.UserSelect;

// Lo mismo, para usar dentro de selects propios.
export const ORDER_FIELDS = { _count: { select: { courses: { where: { status: "APPROVED" as const } } } } } as const;
