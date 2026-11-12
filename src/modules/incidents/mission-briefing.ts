import { prisma } from "../../config/prisma";
import { stationDate } from "../../utils/station-time";

// "Tu movil en salida": quien integra una dotacion que todavia no volvio ve, de forma breve, las fallas,
// faltantes y novedades del movil en que salio. Desaparece cuando el movil vuelve al cuartel.
type Level = "critical" | "warning" | "info";
type Note = { level: Level; text: string; detail?: string };

const COMPLIANCE: Record<string, string> = { VTV: "VTV", INSURANCE: "Seguro", SERVICE: "Service", SCBA_SERVICE: "Service de ERA", CERTIFICATION: "Certificación", OTHER: "Documentación" };

export async function missionBriefing(userId: string) {
  const movements = await prisma.missionMovement.findMany({
    where: { returnedAt: null, crew: { some: { userId } }, incident: { voidedAt: null } },
    orderBy: { departedAt: "desc" },
    select: {
      id: true, assetId: true, departedAt: true, arrivedAt: true, dispatchExceptionReason: true, driverUserId: true, leaderUserId: true,
      incident: { select: { id: true, title: true, location: true } },
      asset: { select: { name: true, notes: true, vehicle: { select: { id: true, unitNumber: true } } } },
    },
  });
  const today = new Date(stationDate()), now = new Date();
  return Promise.all(movements.map(async (m) => {
    const vehicleId = m.asset.vehicle?.id;
    const [jobs, inspection, inventory, compliance] = await Promise.all([
      prisma.maintenanceJob.findMany({ where: { assetId: m.assetId, status: { in: ["OPEN", "IN_PROGRESS"] } }, orderBy: [{ blocksOperation: "desc" }, { createdAt: "desc" }], select: { title: true, description: true, blocksOperation: true } }),
      vehicleId ? prisma.inspection.findFirst({ where: { vehicleId, voidedAt: null }, orderBy: [{ inspectionDate: "desc" }, { createdAt: "desc" }], select: { inspectionDate: true, observations: true, items: { where: { result: { in: ["MISSING", "DAMAGED"] } }, select: { result: true, observations: true, inventoryItem: { select: { name: true, compartment: { select: { name: true } } } } } } } }) : null,
      vehicleId ? prisma.vehicleInventoryItem.findMany({ where: { compartment: { vehicleId }, OR: [{ state: { in: ["REVIEW", "OUT"] } }, { expiresOn: { lt: today } }] }, select: { name: true, state: true, expiresOn: true, notes: true, compartment: { select: { name: true } } } }) : [],
      prisma.complianceRecord.findMany({ where: { assetId: m.assetId, deletedAt: null, expiresAt: { not: null } }, select: { category: true, title: true, expiresAt: true, warningDays: true } }),
    ]);
    const notes: Note[] = [];
    if (m.dispatchExceptionReason) notes.push({ level: "warning", text: "Salió de forma excepcional", detail: m.dispatchExceptionReason });
    for (const j of jobs) notes.push({ level: j.blocksOperation ? "critical" : "warning", text: j.title, detail: j.description.slice(0, 160) });
    for (const c of compliance) {
      const label = COMPLIANCE[c.category] ?? c.title;
      if (c.expiresAt! < now) notes.push({ level: "critical", text: `${label} vencido`, detail: c.title });
      else if (+c.expiresAt! - +now < c.warningDays * 86_400_000) notes.push({ level: "info", text: `${label} vence pronto`, detail: c.expiresAt!.toISOString().slice(0, 10) });
    }
    // Faltantes y daños del ultimo control, sin repetir lo que ya figura en el inventario.
    const seen = new Set<string>();
    for (const i of inspection?.items ?? []) {
      const key = `${i.inventoryItem.compartment.name}|${i.inventoryItem.name}`; seen.add(key);
      notes.push({ level: "warning", text: `${i.result === "MISSING" ? "Falta" : "Dañado"}: ${i.inventoryItem.name}`, detail: [i.inventoryItem.compartment.name, i.observations].filter(Boolean).join(" · ") });
    }
    for (const i of inventory) {
      const key = `${i.compartment.name}|${i.name}`; if (seen.has(key)) continue;
      const expired = i.expiresOn && i.expiresOn < today;
      notes.push({ level: i.state === "OUT" ? "warning" : "info", text: `${expired ? "Vencido" : i.state === "OUT" ? "Fuera de servicio" : "En revisión"}: ${i.name}`, detail: [i.compartment.name, i.notes].filter(Boolean).join(" · ") });
    }
    if (inspection?.observations) notes.push({ level: "info", text: "Observaciones del último control", detail: inspection.observations.slice(0, 200) });
    const order: Record<Level, number> = { critical: 0, warning: 1, info: 2 };
    notes.sort((a, b) => order[a.level] - order[b.level]);
    return {
      movementId: m.id, incident: m.incident, vehicle: m.asset.vehicle?.unitNumber ?? m.asset.name, vehicleName: m.asset.name,
      departedAt: m.departedAt, arrivedAt: m.arrivedAt, role: m.driverUserId === userId ? "Conductor" : m.leaderUserId === userId ? "A cargo" : "Dotación",
      lastControl: inspection?.inspectionDate ?? null, notes: notes.slice(0, 15), hiddenNotes: Math.max(0, notes.length - 15),
    };
  }));
}
