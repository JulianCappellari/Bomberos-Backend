import { prisma } from "../../config/prisma";
import { sortByPerson } from "../../utils/people-order";
import { ORDER_FIELDS } from "../../utils/public-user";
import { OperationError } from "../operations/operations.schemas";
import { isSupplyManager } from "./supplies.service";

type Actor = Parameters<typeof isSupplyManager>[0];
const ORDER: Record<string, number> = { OUT: 0, REVIEW: 1, WORN: 2 };

/** Prendas que el personal declaro y no estan al 100%: primero lo que no se puede usar, despues lo gastado. */
export async function clothingToReplace(actor: Actor) {
  if (!isSupplyManager(actor)) throw new OperationError(403, "Solo el encargado de indumentaria");
  const rows = await prisma.personalDeclaration.findMany({
    where: { category: "CLOTHING", deletedAt: null, clothingCondition: { in: ["WORN", "REVIEW", "OUT"] }, user: { isActive: true, deletedAt: null } },
    select: { id: true, title: true, clothingBrand: true, clothingModel: true, clothingSize: true, clothingCondition: true, clothingNovelties: true, updatedAt: true,
      user: { select: { id: true, username: true, ...ORDER_FIELDS, profile: { select: { fullName: true, rank: true, joinDate: true } } } } },
  });
  return sortByPerson(rows, (r) => r.user)
    .sort((a, b) => (ORDER[a.clothingCondition ?? ""] ?? 9) - (ORDER[b.clothingCondition ?? ""] ?? 9))
    .map(({ user, ...r }) => ({ ...r, person: { id: user.id, name: user.profile?.fullName || user.username, rank: user.profile?.rank ?? null } }));
}
