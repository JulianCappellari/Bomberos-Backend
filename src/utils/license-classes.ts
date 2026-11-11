// Licencia Nacional de Conducir (Ley 24.449, Disposicion ANSV 20/2019): clases y subclases.
// D.4 es la subclase de vehiculos de urgencia y emergencia (bomberos, ambulancias) y siempre se
// acompaña de la subclase del vehiculo (B, C o E). Verificar con la oficina de licencias local.
export const LICENSE_CLASSES = [
  { code: "A.1.1", label: "Ciclomotores hasta 50 cc" }, { code: "A.1.2", label: "Motos hasta 150 cc" },
  { code: "A.1.3", label: "Motos hasta 300 cc" }, { code: "A.1.4", label: "Motos de más de 300 cc" },
  { code: "A.2.1", label: "Triciclos y cuatriciclos hasta 300 cc" }, { code: "A.2.2", label: "Triciclos y cuatriciclos de más de 300 cc" },
  { code: "A.3", label: "Triciclos y cuatriciclos con cabina" },
  { code: "B.1", label: "Autos, camionetas y utilitarios hasta 3.500 kg" }, { code: "B.2", label: "B.1 con acoplado hasta 750 kg o casa rodante" },
  { code: "C.1", label: "Camiones sin acoplado de 3.500 a 12.000 kg" }, { code: "C.2", label: "Camiones de 12.000 a 24.000 kg" },
  { code: "C.3", label: "Camiones de más de 24.000 kg" },
  { code: "D.1", label: "Transporte de pasajeros hasta 8 plazas" }, { code: "D.2", label: "Transporte de pasajeros de 9 a 20 plazas" },
  { code: "D.3", label: "Transporte de pasajeros de más de 20 plazas" }, { code: "D.4", label: "Vehículos de urgencia y emergencia" },
  { code: "E.1", label: "Camiones articulados o con acoplado" }, { code: "E.2", label: "Maquinaria especial no agrícola" },
  { code: "F", label: "Vehículos adaptados" }, { code: "G.1", label: "Tractores agrícolas" }, { code: "G.2", label: "Maquinaria especial agrícola" },
] as const;
/** Acepta "b1", "B1", "B.1", "A11" o "A.1.1" y devuelve la forma oficial ("B.1", "A.1.1"). */
export function normalizeLicenseClass(value: string) {
  const v = value.trim().toUpperCase().replace(/\s+/g, "");
  const m = v.match(/^([A-G])\.?(\d)?(?:\.?(\d))?$/);
  if (!m) return v;
  return [m[1], m[2], m[3]].filter(Boolean).join(".");
}
export type LicenseClassCode = (typeof LICENSE_CLASSES)[number]["code"];
export const LICENSE_CLASS_CODES = LICENSE_CLASSES.map((c) => c.code) as [LicenseClassCode, ...LicenseClassCode[]];

// Una subclase mayor incluye a las menores (ej. C.2 habilita C.1 y B.1; E.1 habilita B y C).
const INCLUDES: Partial<Record<LicenseClassCode, LicenseClassCode[]>> = {
  "A.1.2": ["A.1.1"], "A.1.3": ["A.1.2"], "A.1.4": ["A.1.3"], "A.2.2": ["A.2.1"],
  "B.2": ["B.1"], "C.1": ["B.1"], "C.2": ["C.1"], "C.3": ["C.2"], "E.1": ["C.3", "B.2"],
  "D.2": ["D.1"], "D.3": ["D.2"],
};
export function expandClasses(held: string[]) {
  const result = new Set<string>(), queue = [...held];
  while (queue.length) { const code = queue.pop()!; if (result.has(code)) continue; result.add(code); queue.push(...(INCLUDES[code as LicenseClassCode] ?? [])); }
  return result;
}

// Que licencia exige cada movil segun su porte. Siempre D.4 (emergencia) mas la del vehiculo.
export const VEHICLE_LICENSE_CATEGORIES = {
  UNSET: { label: "Sin configurar (habilitación manual de jefatura)", required: [] as LicenseClassCode[] },
  LIGHT: { label: "Liviano hasta 3.500 kg (camioneta, utilitario)", required: ["B.1", "D.4"] as LicenseClassCode[] },
  MEDIUM: { label: "Camión de 3.500 a 12.000 kg (autobomba liviana o mediana)", required: ["C.1", "D.4"] as LicenseClassCode[] },
  HEAVY: { label: "Camión de 12.000 a 24.000 kg (autobomba pesada, cisterna)", required: ["C.2", "D.4"] as LicenseClassCode[] },
  EXTRA_HEAVY: { label: "Camión de más de 24.000 kg", required: ["C.3", "D.4"] as LicenseClassCode[] },
  ARTICULATED: { label: "Con acoplado o semirremolque", required: ["E.1", "D.4"] as LicenseClassCode[] },
} as const;
export type VehicleLicenseCategory = keyof typeof VEHICLE_LICENSE_CATEGORIES;
export const VEHICLE_LICENSE_CATEGORY_KEYS = Object.keys(VEHICLE_LICENSE_CATEGORIES) as [VehicleLicenseCategory, ...VehicleLicenseCategory[]];

export type ClassDetail = { code: string; grantedOn?: string | null; expiresOn?: string | null };
type License = { id: string; revision: number; issuedOn: Date | null; expiresOn: Date | null; licenseClasses: string[]; licenseClassDetails: unknown };

/** Clases vigentes hoy en una licencia: cada clase puede tener su propio otorgamiento y vencimiento. */
export function currentClasses(license: License, today: Date) {
  if (!license.issuedOn || !license.expiresOn || license.issuedOn > today || license.expiresOn < today) return [];
  const details = Array.isArray(license.licenseClassDetails) ? license.licenseClassDetails as ClassDetail[] : [];
  return license.licenseClasses.map(normalizeLicenseClass).filter((code) => {
    const d = details.find((x) => normalizeLicenseClass(x.code) === code);
    if (d?.grantedOn && new Date(d.grantedOn) > today) return false;
    if (d?.expiresOn && new Date(d.expiresOn) < today) return false;
    return true;
  });
}

/** ¿Las licencias vigentes de una persona cubren lo que exige el movil? Devuelve la licencia usada o lo que falta. */
export function licenseCoverage(licenses: License[], category: string, today: Date) {
  const required = VEHICLE_LICENSE_CATEGORIES[category as VehicleLicenseCategory]?.required ?? [];
  if (!required.length) return { configured: false as const, eligible: false, missing: [] as string[], licenseId: null as string | null, licenseRevision: null as number | null };
  const usable = licenses.map((l) => ({ license: l, held: expandClasses(currentClasses(l, today)) }));
  const all = new Set(usable.flatMap((u) => [...u.held]));
  const missing = required.filter((code) => !all.has(code));
  const main = usable.find((u) => required.every((code) => u.held.has(code))) ?? usable.find((u) => u.held.size) ?? null;
  return { configured: true as const, eligible: missing.length === 0, missing, licenseId: main?.license.id ?? null, licenseRevision: main?.license.revision ?? null };
}
