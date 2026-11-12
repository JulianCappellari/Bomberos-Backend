import { prisma } from "../../config/prisma";
import { stationDate } from "../../utils/station-time";
import { hydroCurrent } from "../air/air.rules";

// "Tu movil en salida": quien integra una dotacion que todavia no volvio ve, de forma breve, las fallas,
// faltantes y novedades del movil en que salio. Desaparece cuando el movil vuelve al cuartel.
type Level = "critical" | "warning" | "info";
type Note = { level: Level; text: string; detail?: string };

const MAX_NOTES = 30;
const FUEL: Record<string, { level: Level; label: string }> = { RESERVE: { level: "critical", label: "en reserva" }, QUARTER: { level: "warning", label: "en 1/4" }, HALF: { level: "info", label: "en 1/2" } };
const ASSET_STATUS: Record<string, string> = { MAINTENANCE: "Unidad marcada en mantenimiento", OUT_OF_SERVICE: "Unidad marcada fuera de servicio" };
const COMPLIANCE: Record<string, string> = { VTV: "VTV", INSURANCE: "Seguro", SERVICE: "Service", SCBA_SERVICE: "Service de ERA", CERTIFICATION: "Certificación", OTHER: "Documentación" };

export async function missionBriefing(userId: string) {
  const movements = await prisma.missionMovement.findMany({
    where: { returnedAt: null, crew: { some: { userId } }, incident: { voidedAt: null } },
    orderBy: { departedAt: "desc" },
    select: {
      id: true, assetId: true, departedAt: true, arrivedAt: true, dispatchExceptionReason: true, driverUserId: true, leaderUserId: true,
      incident: { select: { id: true, title: true, location: true } },
      asset: { select: { name: true, notes: true, status: true, vehicle: { select: { id: true, unitNumber: true, fuelType: true, mileage: true, nextOilChangeMileage: true } } } },
    },
  });
  const todayKey = stationDate(), today = new Date(todayKey), now = new Date();
  return Promise.all(movements.map(async (m) => {
    const vehicle = m.asset.vehicle, vehicleId = vehicle?.id;
    const [jobs, inspection, inventory, compliance, cylinders, requests] = await Promise.all([
      prisma.maintenanceJob.findMany({ where: { assetId: m.assetId, status: { in: ["OPEN", "IN_PROGRESS"] } }, orderBy: [{ blocksOperation: "desc" }, { createdAt: "desc" }], select: { title: true, description: true, blocksOperation: true } }),
      vehicleId ? prisma.inspection.findFirst({ where: { vehicleId, voidedAt: null }, orderBy: [{ inspectionDate: "desc" }, { createdAt: "desc" }], select: {
        inspectionDate: true, observations: true, oilLevel: true, coolantLevel: true, fuelLevel: true,
        items: { where: { OR: [{ result: { in: ["MISSING", "DAMAGED"] } }, { observedQuantity: { lt: prisma.inspectionItem.fields.expectedQuantity } }] }, select: { result: true, expectedQuantity: true, observedQuantity: true, observations: true, inventoryItem: { select: { name: true, compartment: { select: { name: true } } } } } },
      } }) : null,
      vehicleId ? prisma.vehicleInventoryItem.findMany({ where: { compartment: { vehicleId }, OR: [{ state: { in: ["REVIEW", "OUT"] } }, { expiresOn: { lt: today } }] }, select: { name: true, state: true, expiresOn: true, notes: true, compartment: { select: { name: true } } } }) : [],
      prisma.complianceRecord.findMany({ where: { assetId: m.assetId, deletedAt: null, expiresAt: { not: null } }, select: { category: true, title: true, expiresAt: true, warningDays: true } }),
      prisma.airCylinder.findMany({ where: { vehicleAssetId: m.assetId, retiredAt: null }, orderBy: { code: "asc" }, select: { code: true, ratedPressureBar: true, pressureBar: true, asset: { select: { status: true } }, hydroTests: { orderBy: { testedOn: "desc" }, take: 1, select: { result: true, validUntil: true } } } }),
      vehicleId ? prisma.materialRequest.findMany({ where: { vehicleId, status: { in: ["PENDING", "APPROVED", "ORDERED"] } }, orderBy: { createdAt: "desc" }, take: 10, select: { title: true, quantity: true, details: true } }) : [],
    ]);
    const notes: Note[] = [];
    const statusLabel = ASSET_STATUS[m.asset.status as string];
    if (statusLabel) notes.push({ level: "critical", text: statusLabel, detail: m.asset.notes?.slice(0, 160) || undefined });
    if (m.dispatchExceptionReason) notes.push({ level: "warning", text: "Salió de forma excepcional", detail: m.dispatchExceptionReason });
    for (const j of jobs) notes.push({ level: j.blocksOperation ? "critical" : "warning", text: j.title, detail: [j.blocksOperation ? "Falla que impide operar" : "Falla reportada en mantenimiento", j.description.slice(0, 160)].filter(Boolean).join(" · ") });

    // Fluidos y combustible del ultimo control.
    if (inspection) {
      const fuel = inspection.fuelLevel ? FUEL[inspection.fuelLevel] : undefined;
      if (fuel) notes.push({ level: fuel.level, text: `Combustible ${fuel.label}`, detail: fuel.level === "info" ? undefined : "Cargar antes de volver a salir" });
      const fluids: Array<[string | null, string]> = [[inspection.oilLevel, "Aceite de motor"], [inspection.coolantLevel, "Líquido refrigerante"]];
      for (const [value, name] of fluids) {
        if (value === "LOW") notes.push({ level: "warning", text: `${name} bajo`, detail: "Registrado en el último control sin completar" });
        else if (value === "ADDED") notes.push({ level: "info", text: `${name}: se completó en el último control`, detail: "Si vuelve a bajar, puede haber una pérdida" });
      }
    }
    if (vehicle?.mileage != null && vehicle.nextOilChangeMileage != null && vehicle.mileage >= vehicle.nextOilChangeMileage) notes.push({ level: "warning", text: "Cambio de aceite vencido", detail: `${vehicle.mileage.toLocaleString("es-AR")} km (tocaba a los ${vehicle.nextOilChangeMileage.toLocaleString("es-AR")} km)` });

    // Equipos autonomos (ERA) cargados en la unidad.
    for (const c of cylinders) {
      const pct = c.pressureBar == null ? null : c.pressureBar / c.ratedPressureBar;
      const pressure = c.pressureBar == null ? "" : ` (${c.pressureBar} de ${c.ratedPressureBar} bar)`;
      if (pct === null) notes.push({ level: "warning", text: `Tubo autónomo ${c.code} sin presión registrada`, detail: "Verificar la carga antes de usarlo" });
      else if (pct < 0.5) notes.push({ level: "critical", text: `Tubo autónomo ${c.code} descargado${pressure}` });
      else if (pct < 0.9) notes.push({ level: "warning", text: `Tubo autónomo ${c.code} con carga parcial${pressure}` });
      const test = c.hydroTests[0];
      if (!hydroCurrent(test, todayKey)) notes.push({ level: "critical", text: `Tubo autónomo ${c.code}: ${test?.result === "FAIL" ? "prueba hidráulica rechazada" : "prueba hidráulica vencida"}`, detail: test?.validUntil ? `Vigente hasta ${test.validUntil.toISOString().slice(0, 10)}` : "Sin prueba vigente registrada" });
      if (c.asset.status !== "OPERATIONAL") notes.push({ level: "warning", text: `Tubo autónomo ${c.code} ${c.asset.status === "OUT_OF_SERVICE" ? "fuera de servicio" : "en mantenimiento"}` });
    }

    for (const c of compliance) {
      const label = COMPLIANCE[c.category] ?? c.title;
      if (c.expiresAt! < now) notes.push({ level: "critical", text: `${label} vencido`, detail: c.title });
      else if (+c.expiresAt! - +now < c.warningDays * 86_400_000) notes.push({ level: "info", text: `${label} vence pronto`, detail: c.expiresAt!.toISOString().slice(0, 10) });
    }
    // Faltantes y daños del ultimo control, con cantidades, sin repetir lo que ya figura en el inventario.
    const seen = new Set<string>();
    for (const i of inspection?.items ?? []) {
      const key = `${i.inventoryItem.compartment.name}|${i.inventoryItem.name}`; seen.add(key);
      const qty = i.observedQuantity < i.expectedQuantity ? ` (hay ${i.observedQuantity} de ${i.expectedQuantity})` : "";
      const text = i.result === "DAMAGED" ? `Dañado: ${i.inventoryItem.name}${qty}`
        : i.observedQuantity === 0 ? `Falta: ${i.inventoryItem.name}${i.expectedQuantity > 1 ? ` (${i.expectedQuantity})` : ""}`
        : `Falta: ${i.inventoryItem.name}${qty}`;
      notes.push({ level: "warning", text, detail: [i.inventoryItem.compartment.name, i.observations].filter(Boolean).join(" · ") });
    }
    for (const i of inventory) {
      const key = `${i.compartment.name}|${i.name}`; if (seen.has(key)) continue;
      const expired = i.expiresOn && i.expiresOn < today;
      notes.push({ level: i.state === "OUT" ? "warning" : "info", text: `${expired ? "Vencido" : i.state === "OUT" ? "Fuera de servicio" : "En revisión"}: ${i.name}`, detail: [i.compartment.name, expired ? `Venció ${i.expiresOn!.toISOString().slice(0, 10)}` : null, i.notes].filter(Boolean).join(" · ") });
    }
    for (const r of requests) notes.push({ level: "info", text: `Pedido pendiente: ${r.title}${r.quantity > 1 ? ` (${r.quantity})` : ""}`, detail: r.details?.slice(0, 160) || undefined });
    if (inspection?.observations) notes.push({ level: "info", text: "Observaciones del último control", detail: inspection.observations.slice(0, 400) });
    const order: Record<Level, number> = { critical: 0, warning: 1, info: 2 };
    notes.sort((a, b) => order[a.level] - order[b.level]);
    const count = (level: Level) => notes.filter((n) => n.level === level).length;
    return {
      movementId: m.id, incident: m.incident, vehicle: vehicle?.unitNumber ?? m.asset.name, vehicleName: m.asset.name,
      departedAt: m.departedAt, arrivedAt: m.arrivedAt, role: m.driverUserId === userId ? "Conductor" : m.leaderUserId === userId ? "A cargo" : "Dotación",
      lastControl: inspection?.inspectionDate ?? null, fuelType: vehicle?.fuelType ?? null,
      counts: { critical: count("critical"), warning: count("warning"), info: count("info") },
      notes: notes.slice(0, MAX_NOTES), hiddenNotes: Math.max(0, notes.length - MAX_NOTES),
    };
  }));
}
