import { Prisma } from "@prisma/client";
import { stationDate } from "../../utils/station-time";
import { currentClasses, expandClasses, licenseCoverage, normalizeLicenseClass, VEHICLE_LICENSE_CATEGORIES, VehicleLicenseCategory } from "../../utils/license-classes";
import { OperationError } from "../operations/operations.schemas";
import { commandUserIds } from "../members/notifications.service";

// Habilitacion de conductores: para manejar un movil hacen falta DOS cosas:
// 1) las licencias vigentes de la persona cubren lo que exige el movil (cada licencia es de una clase), y
// 2) jefatura (oficial o administrador) aprobo que maneje ESE movil.
// Al cargar una licencia que cubre un movil se genera solo el pedido (PENDING) y se avisa a jefatura.
export const OPEN_ENDED = new Date("2999-12-31T00:00:00Z");
export type AuthorizationStatus = "PENDING" | "APPROVED" | "REJECTED" | "REVOKED";
const licenseSelect = { id: true, userId: true, revision: true, issuedOn: true, expiresOn: true, licenseClasses: true, licenseClassDetails: true, licenseNumber: true } as const;

export function authorizationActive(a: { status: string; validUntil: Date } | null | undefined, today: Date) {
  return Boolean(a && a.status === "APPROVED" && a.validUntil >= today);
}

/** Pares movil-persona que las licencias vigentes cubren (sin mirar la autorizacion). */
export async function coveragePairs(tx: Prisma.TransactionClient, userId?: string, today = new Date(stationDate())) {
  const [vehicles, licenses] = await Promise.all([
    tx.vehicle.findMany({ where: { licenseCategory: { not: "UNSET" }, asset: { deletedAt: null } }, select: { assetId: true, licenseCategory: true } }),
    tx.personalDeclaration.findMany({ where: { category: "DRIVER_LICENSE", deletedAt: null, issuedOn: { lte: today }, expiresOn: { gte: today }, ...(userId ? { userId } : {}), user: { isActive: true, deletedAt: null, isPendingApproval: false } }, select: licenseSelect }),
  ]);
  const byUser = new Map<string, typeof licenses>();
  for (const l of licenses) byUser.set(l.userId, [...(byUser.get(l.userId) ?? []), l]);
  const pairs: Array<{ assetId: string; userId: string; required: string }> = [];
  for (const v of vehicles) for (const [uid, own] of byUser) if (licenseCoverage(own, v.licenseCategory, today).eligible) pairs.push({ assetId: v.assetId, userId: uid, required: VEHICLE_LICENSE_CATEGORIES[v.licenseCategory as VehicleLicenseCategory].required.join("+") });
  return pairs;
}

/** Conductores que hoy pueden manejar cada movil: licencia que lo cubre + autorizacion aprobada. */
export async function licensedDriverPairs(tx: Prisma.TransactionClient, today = new Date(stationDate())) {
  const [pairs, approved] = await Promise.all([coveragePairs(tx, undefined, today), tx.vehicleDriverAuthorization.findMany({ where: { status: "APPROVED", validUntil: { gte: today } }, select: { assetId: true, userId: true } })]);
  const ok = new Set(approved.map((a) => `${a.assetId}:${a.userId}`));
  return pairs.filter((p) => ok.has(`${p.assetId}:${p.userId}`)).map(({ assetId, userId }) => ({ assetId, userId }));
}

/**
 * Genera los pedidos de habilitacion que falten para los moviles que las licencias cubren y avisa a jefatura.
 * reopen: al cambiar la persona sus licencias, un pedido rechazado vuelve a quedar pendiente (puede haber cargado lo que faltaba).
 */
export async function syncDriverRequests(tx: Prisma.TransactionClient, opts: { userId?: string; reopen?: boolean } = {}) {
  const pairs = await coveragePairs(tx, opts.userId);
  if (!pairs.length) return [];
  const existing = await tx.vehicleDriverAuthorization.findMany({ where: { OR: pairs.map((p) => ({ assetId: p.assetId, userId: p.userId })) }, select: { assetId: true, userId: true, status: true, validUntil: true } });
  const byKey = new Map(existing.map((e) => [`${e.assetId}:${e.userId}`, e]));
  const created: typeof pairs = [];
  for (const p of pairs) {
    const row = byKey.get(`${p.assetId}:${p.userId}`);
    if (!row) {
      await tx.vehicleDriverAuthorization.create({ data: { assetId: p.assetId, userId: p.userId, status: "PENDING", requiredClass: p.required.slice(0, 12), validUntil: OPEN_ENDED, reason: "" } });
      created.push(p);
    } else if (opts.reopen && (row.status === "REJECTED" || row.status === "REVOKED")) {
      await tx.vehicleDriverAuthorization.update({ where: { assetId_userId: { assetId: p.assetId, userId: p.userId } }, data: { status: "PENDING", requestedAt: new Date(), decidedAt: null, decisionNote: null, validUntil: OPEN_ENDED, requiredClass: p.required.slice(0, 12), revision: { increment: 1 } } });
      created.push(p);
    }
  }
  if (created.length) {
    const users = await tx.user.findMany({ where: { id: { in: [...new Set(created.map((c) => c.userId))] } }, select: { id: true, username: true, profile: { select: { fullName: true } } } });
    const units = await tx.vehicle.findMany({ where: { assetId: { in: [...new Set(created.map((c) => c.assetId))] } }, select: { assetId: true, unitNumber: true } });
    for (const u of users) {
      const mine = created.filter((c) => c.userId === u.id).map((c) => units.find((v) => v.assetId === c.assetId)?.unitNumber).filter(Boolean);
      const recipients = (await commandUserIds(tx)).filter((id) => id !== u.id);
      const key = `driver-request:${u.id}:${[...mine].sort().join(",")}:${stationDate()}`.slice(0, 200);
      await tx.memberNotification.createMany({ data: recipients.map((userId) => ({ userId, dedupeKey: `${key}:${userId}`.slice(0, 200), title: `Habilitación de conductor pendiente: ${u.profile?.fullName || u.username}`, href: "/incidents/logistics", body: `Su licencia cubre ${mine.length === 1 ? "el móvil" : "los móviles"} ${mine.join(", ")}. Revisá y autorizá o rechazá.` })), skipDuplicates: true });
    }
  }
  return created;
}

/** Comprobacion para asignar conductor: licencia que cubre el movil + autorizacion de jefatura vigente. */
export async function driverCheck(tx: Prisma.TransactionClient, assetId: string, userId: string, today = new Date(stationDate())) {
  const [vehicle, auth, licenses] = await Promise.all([
    tx.vehicle.findUnique({ where: { assetId }, select: { licenseCategory: true, unitNumber: true } }),
    tx.vehicleDriverAuthorization.findUnique({ where: { assetId_userId: { assetId, userId } } }),
    tx.personalDeclaration.findMany({ where: { userId, category: "DRIVER_LICENSE", deletedAt: null }, select: licenseSelect }),
  ]);
  const category = (vehicle?.licenseCategory ?? "UNSET") as VehicleLicenseCategory;
  const configured = category !== "UNSET" && Boolean(VEHICLE_LICENSE_CATEGORIES[category]);
  let licenseId: string | null = null, licenseRevision: number | null = null, requiredClass = auth?.requiredClass ?? "";
  if (configured) {
    const coverage = licenseCoverage(licenses, category, today);
    if (!coverage.eligible) throw new OperationError(403, `El conductor no tiene licencia vigente para este móvil: le falta ${coverage.missing.join(" y ")}. Exige ${VEHICLE_LICENSE_CATEGORIES[category].required.join(" + ")}`);
    licenseId = coverage.licenseId; licenseRevision = coverage.licenseRevision; requiredClass = VEHICLE_LICENSE_CATEGORIES[category].required.join("+");
  } else {
    const code = normalizeLicenseClass(auth?.requiredClass ?? "");
    const backing = licenses.find((l) => expandClasses(currentClasses(l, today)).has(code));
    if (!backing) throw new OperationError(403, "El conductor necesita una licencia vigente de la clase que jefatura indicó para este móvil");
    licenseId = backing.id; licenseRevision = backing.revision;
  }
  if (!authorizationActive(auth, today)) {
    const why = auth?.status === "PENDING" ? "su habilitación está pendiente de autorización de jefatura" : auth?.status === "REJECTED" ? "jefatura rechazó su habilitación para este móvil" : auth?.status === "REVOKED" ? "su habilitación para este móvil fue revocada" : "no tiene habilitación de jefatura para este móvil";
    throw new OperationError(403, `No puede conducir el móvil ${vehicle?.unitNumber ?? ""}: ${why}`);
  }
  return { via: configured ? "LICENSE+AUTHORIZATION" : "AUTHORIZATION", requiredClass, licenseId: licenseId!, licenseRevision: licenseRevision!, validUntil: auth!.validUntil.toISOString(), authorizationRevision: auth!.revision };
}

/** Moviles que puede manejar una persona: que exige cada uno, si su licencia lo cubre y el estado de la autorizacion. */
export async function drivingStatus(tx: Prisma.TransactionClient, userId: string, today = new Date(stationDate())) {
  const [vehicles, licenses, auths] = await Promise.all([
    tx.vehicle.findMany({ where: { asset: { deletedAt: null } }, select: { assetId: true, unitNumber: true, licenseCategory: true, asset: { select: { name: true } } }, orderBy: { unitNumber: "asc" } }),
    tx.personalDeclaration.findMany({ where: { userId, category: "DRIVER_LICENSE", deletedAt: null }, select: licenseSelect }),
    tx.vehicleDriverAuthorization.findMany({ where: { userId }, include: { grantedBy: { select: { username: true, profile: { select: { fullName: true } } } } } }),
  ]);
  return vehicles.map((v) => {
    const category = v.licenseCategory as VehicleLicenseCategory, rule = VEHICLE_LICENSE_CATEGORIES[category];
    const configured = category !== "UNSET" && Boolean(rule);
    const coverage = configured ? licenseCoverage(licenses, category, today) : null;
    const auth = auths.find((a) => a.assetId === v.assetId);
    const status = authorizationActive(auth, today) ? "APPROVED" : auth?.status === "APPROVED" ? "REVOKED" : (auth?.status ?? "NONE");
    const covered = configured ? Boolean(coverage?.eligible) : Boolean(auth && licenses.some((l) => expandClasses(currentClasses(l, today)).has(normalizeLicenseClass(auth.requiredClass))));
    return {
      assetId: v.assetId, unitNumber: v.unitNumber, name: v.asset.name, category, required: rule?.required ?? [], configured,
      covered, missing: coverage?.missing ?? [], authorization: status as AuthorizationStatus | "NONE",
      decidedAt: auth?.decidedAt ?? null, decisionNote: auth?.decisionNote ?? null,
      decidedBy: auth?.grantedBy ? auth.grantedBy.profile?.fullName || auth.grantedBy.username : null,
      canDrive: covered && status === "APPROVED",
    };
  });
}
