import { Prisma } from "@prisma/client";
import { stationDate } from "../../utils/station-time";
import { licenseCoverage, VEHICLE_LICENSE_CATEGORIES, VehicleLicenseCategory } from "../../utils/license-classes";

const licenseSelect = { id: true, userId: true, revision: true, issuedOn: true, expiresOn: true, licenseClasses: true, licenseClassDetails: true } as const;

/** Moviles con categoria de licencia configurada y, para cada uno, quienes lo pueden manejar por su licencia vigente. */
export async function licensedDriverPairs(tx: Prisma.TransactionClient, today = new Date(stationDate())) {
  const [vehicles, licenses] = await Promise.all([
    tx.vehicle.findMany({ where: { licenseCategory: { not: "UNSET" }, asset: { deletedAt: null } }, select: { assetId: true, licenseCategory: true } }),
    tx.personalDeclaration.findMany({ where: { category: "DRIVER_LICENSE", deletedAt: null, issuedOn: { lte: today }, expiresOn: { gte: today }, user: { isActive: true, deletedAt: null, isPendingApproval: false } }, select: licenseSelect }),
  ]);
  const byUser = new Map<string, typeof licenses>();
  for (const l of licenses) byUser.set(l.userId, [...(byUser.get(l.userId) ?? []), l]);
  const pairs: Array<{ assetId: string; userId: string }> = [];
  for (const v of vehicles) for (const [userId, own] of byUser) if (licenseCoverage(own, v.licenseCategory, today).eligible) pairs.push({ assetId: v.assetId, userId });
  return pairs;
}

/** ¿Esta persona puede manejar este movil por su licencia? Para moviles sin categoria devuelve configured=false. */
export async function driverLicenseCheck(tx: Prisma.TransactionClient, assetId: string, userId: string, today = new Date(stationDate())) {
  const vehicle = await tx.vehicle.findUnique({ where: { assetId }, select: { licenseCategory: true } });
  const category = (vehicle?.licenseCategory ?? "UNSET") as VehicleLicenseCategory;
  if (category === "UNSET" || !VEHICLE_LICENSE_CATEGORIES[category]) return { configured: false as const, category };
  const licenses = await tx.personalDeclaration.findMany({ where: { userId, category: "DRIVER_LICENSE", deletedAt: null }, select: licenseSelect });
  return { ...licenseCoverage(licenses, category, today), category, required: VEHICLE_LICENSE_CATEGORIES[category].required };
}
