import { prisma } from "../../config/prisma";
import { normalizeRank } from "../../utils/firefighter-ranks";
import { financeAccess } from "../../utils/finance-access";
import { OperationError } from "../operations/operations.schemas";

// Apartado de la Comision Directiva: consulta (solo lectura) de finanzas y transparencia del cuartel.
type Actor = { userId: string; role: string };

export async function commissionAccess(actor: Actor) {
  if (actor.role === "GUARD") return false;
  const user = await prisma.user.findUnique({ where: { id: actor.userId }, select: { isActive: true, deletedAt: true, profile: { select: { rank: true } } } });
  if (!user?.isActive || user.deletedAt) return false;
  const rank = normalizeRank(user.profile?.rank).replace(/\s/g, "");
  if (rank === "comisiondirectiva" || rank === "administrador") return true;
  return (await financeAccess(actor.userId, actor.role)).canManage;
}

const monthKey = (d: Date) => d.toISOString().slice(0, 7);
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

export async function commissionOverview(actor: Actor, months: number) {
  if (!(await commissionAccess(actor))) throw new OperationError(403, "Apartado reservado a la Comisión Directiva y a administración");
  const since = new Date(); since.setUTCDate(1); since.setUTCHours(0, 0, 0, 0); since.setUTCMonth(since.getUTCMonth() - (months - 1));
  const last30 = new Date(Date.now() - 30 * 86_400_000);
  const [claims, payments, trips, crew, users, audits, materialOpen, lowStock, movements, members, alerts, incidents] = await Promise.all([
    prisma.expenseClaim.findMany({ where: { createdAt: { gte: since } }, omit: { receiptBytes: true }, include: { payments: { select: { amountCents: true, reversedAt: true, createdAt: true } }, approvals: { select: { userId: true, rankSnapshot: true, decision: true, note: true, createdAt: true } } }, orderBy: { occurredOn: "desc" } }),
    prisma.expensePayment.findMany({ where: { createdAt: { gte: since } }, select: { amountCents: true, reversedAt: true, createdAt: true } }),
    prisma.waterTrip.findMany({ where: { voidedAt: null, departedAt: { gte: since } }, select: { id: true, customer: true, destination: true, departedAt: true, tripCount: true, chargeCents: true, clientPaidAt: true, asset: { select: { name: true } } }, orderBy: { departedAt: "desc" } }),
    prisma.waterTripMember.findMany({ where: { trip: { voidedAt: null, departedAt: { gte: since } } }, select: { compensationCents: true, paidAt: true } }),
    prisma.user.findMany({ select: { id: true, username: true, profile: { select: { fullName: true } } } }),
    prisma.auditLog.findMany({ where: { entityType: { in: ["ExpenseClaim", "ExpensePayment", "WaterTrip", "FinanceAccess"] }, createdAt: { gte: since } }, orderBy: { createdAt: "desc" }, take: 40, select: { id: true, action: true, createdAt: true, actorUserId: true, entityType: true } }),
    prisma.materialRequest.count({ where: { status: { in: ["PENDING", "APPROVED", "ORDERED"] } } }),
    prisma.supplyItem.findMany({ where: { archivedAt: null, minQuantity: { gt: 0 } }, select: { quantity: true, minQuantity: true } }),
    prisma.supplyMovement.groupBy({ by: ["type"], where: { createdAt: { gte: last30 } }, _sum: { quantity: true } }),
    prisma.user.count({ where: { isActive: true, deletedAt: null, isPendingApproval: false, guardForUserId: null } }),
    prisma.alert.count({ where: { createdAt: { gte: last30 } } }),
    prisma.incident.count({ where: { createdAt: { gte: last30 } } }),
  ]);
  const name = (id: string | null) => { const u = users.find((x) => x.id === id); return u ? u.profile?.fullName || u.username : "Sistema"; };
  const paidOf = (c: typeof claims[number]) => sum(c.payments.filter((p) => !p.reversedAt).map((p) => p.amountCents));

  // Serie mensual: gastos aprobados, pagos efectivos e ingresos por viajes de agua.
  const series = new Map<string, { month: string; approvedCents: number; paidCents: number; waterIncomeCents: number }>();
  for (let i = 0; i < months; i++) { const d = new Date(since); d.setUTCMonth(d.getUTCMonth() + i); series.set(monthKey(d), { month: monthKey(d), approvedCents: 0, paidCents: 0, waterIncomeCents: 0 }); }
  for (const c of claims) if (c.status === "APPROVED") { const row = series.get(monthKey(c.occurredOn)); if (row) row.approvedCents += c.amountCents; }
  for (const p of payments) if (!p.reversedAt) { const row = series.get(monthKey(p.createdAt)); if (row) row.paidCents += p.amountCents; }
  for (const t of trips) { const row = series.get(monthKey(t.departedAt)); if (row) row.waterIncomeCents += t.chargeCents; }

  const approved = claims.filter((c) => c.status === "APPROVED");
  return {
    generatedAt: new Date(), since, months,
    totals: {
      expensesApprovedCents: sum(approved.map((c) => c.amountCents)),
      expensesPaidCents: sum(payments.filter((p) => !p.reversedAt).map((p) => p.amountCents)),
      expensesDebtCents: sum(approved.map((c) => c.amountCents - paidOf(c))),
      expensesPendingCents: sum(claims.filter((c) => c.status === "PENDING").map((c) => c.amountCents)),
      expensesRejectedCount: claims.filter((c) => c.status === "REJECTED").length,
      paymentsReversed: payments.filter((p) => p.reversedAt).length,
      waterIncomeCents: sum(trips.map((t) => t.chargeCents)),
      waterCollectedCents: sum(trips.filter((t) => t.clientPaidAt).map((t) => t.chargeCents)),
      waterUncollectedCents: sum(trips.filter((t) => !t.clientPaidAt).map((t) => t.chargeCents)),
      crewCompensationPaidCents: sum(crew.filter((m) => m.paidAt).map((m) => m.compensationCents)),
      crewCompensationPendingCents: sum(crew.filter((m) => !m.paidAt).map((m) => m.compensationCents)),
    },
    series: [...series.values()],
    expenses: claims.slice(0, 60).map((c) => ({
      id: c.id, title: c.title, amountCents: c.amountCents, occurredOn: c.occurredOn, status: c.status, requestedBy: name(c.userId), paidCents: paidOf(c), hasReceipt: Boolean(c.receiptSha256 || c.receiptUrl), officerExpense: c.officerExpense,
      approvals: c.approvals.map((a) => ({ by: name(a.userId), rank: a.rankSnapshot, decision: a.decision, note: a.note, at: a.createdAt })),
    })),
    waterTrips: trips.slice(0, 40).map((t) => ({ id: t.id, customer: t.customer, destination: t.destination, departedAt: t.departedAt, tripCount: t.tripCount, chargeCents: t.chargeCents, collected: Boolean(t.clientPaidAt), vehicle: t.asset.name })),
    activity: audits.map((a) => ({ id: a.id, action: a.action, at: a.createdAt, by: name(a.actorUserId), entity: a.entityType })),
    station: {
      activeMembers: members, alertsLast30Days: alerts, incidentsLast30Days: incidents,
      openMaterialRequests: materialOpen, lowStockItems: lowStock.filter((i) => i.quantity <= i.minQuantity).length,
      suppliesLast30Days: Object.fromEntries(movements.map((m) => [m.type, m._sum.quantity ?? 0])),
    },
  };
}
