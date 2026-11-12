import { prisma } from "../../config/prisma";

// Buscador de materiales: "destornillador" -> en que movil y en que baulera esta (y si hay en el deposito del cuartel).
// Busca sin importar mayusculas ni acentos, por cada palabra escrita y en singular o plural.
const fold = (v: string) => v.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("es");
// Singular aproximado: "destornilladores" -> "destornillador", "mangueras" -> "manguera", "llaves" -> "llave".
const stem = (w: string) => w.length > 5 && /[^aeiou]es$/.test(w) ? w.slice(0, -2) : w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w;

export async function searchMaterials(query: string) {
  const words = fold(query).split(/\s+/).filter((w) => w.length >= 2).slice(0, 5).map(stem);
  if (!words.length) return { query, vehicles: [], storeroom: [] };
  // Los inventarios de los moviles y el deposito son chicos: se comparan en memoria, sin acentos (la base distingue tildes).
  const [items, supplies] = await Promise.all([
    prisma.vehicleInventoryItem.findMany({
      where: { compartment: { vehicle: { asset: { deletedAt: null } } } },
      take: 5000,
      select: { id: true, name: true, labelCode: true, expectedQuantity: true, state: true, notes: true, compartment: { select: { name: true, vehicle: { select: { id: true, unitNumber: true, asset: { select: { id: true, name: true, status: true } } } } } } },
    }),
    prisma.supplyItem.findMany({ where: { archivedAt: null }, take: 2000, select: { id: true, name: true, size: true, quantity: true, location: true, unit: true } }),
  ]);
  const matches = (text: string) => { const t = fold(text); return words.every((w) => t.includes(w)); };
  const vehicles = items
    .filter((i) => matches(`${i.name} ${i.labelCode ?? ""} ${i.notes ?? ""}`))
    .slice(0, 200)
    .map((i) => ({ id: i.id, name: i.name, labelCode: i.labelCode, quantity: i.expectedQuantity, state: i.state, compartment: i.compartment.name, vehicle: { id: i.compartment.vehicle.id, assetId: i.compartment.vehicle.asset.id, unitNumber: i.compartment.vehicle.unitNumber, name: i.compartment.vehicle.asset.name, status: i.compartment.vehicle.asset.status } }))
    .sort((a, b) => a.vehicle.unitNumber.localeCompare(b.vehicle.unitNumber, "es", { numeric: true }) || a.compartment.localeCompare(b.compartment, "es") || a.name.localeCompare(b.name, "es"));
  const storeroom = supplies.filter((s) => matches(`${s.name} ${s.location ?? ""}`)).slice(0, 50).map((s) => ({ id: s.id, name: s.name, size: s.size, quantity: s.quantity, unit: s.unit, location: s.location }));
  return { query, vehicles, storeroom };
}
