import { prisma } from "../../config/prisma";
import { normalizeRank } from "../../utils/firefighter-ranks";
import { sortPeople } from "../../utils/people-order";
import { ORDER_FIELDS } from "../../utils/public-user";

/** Personal activo con su telefono, en orden institucional. Sin las cuentas de guardia vinculadas (duplican a la persona). */
export async function staffDirectory() {
  const rows = await prisma.user.findMany({
    where: { deletedAt: null, isActive: true, isPendingApproval: false, guardForUserId: null },
    select: { id: true, username: true, ...ORDER_FIELDS, profile: { select: { fullName: true, rank: true, badge: true, avatarUrl: true, joinDate: true, phone: true, altPhone: true } } },
  });
  return sortPeople(rows.filter((r) => r.profile && normalizeRank(r.profile.rank) !== "administrador")).map((r) => ({
    id: r.id, fullName: r.profile!.fullName, rank: r.profile!.rank, badge: r.profile!.badge, avatarUrl: r.profile!.avatarUrl,
    phone: r.profile!.phone || null, altPhone: r.profile!.altPhone || null,
    group: normalizeRank(r.profile!.rank) === "comision directiva" ? "Comisión Directiva" : "Cuerpo activo",
  }));
}
