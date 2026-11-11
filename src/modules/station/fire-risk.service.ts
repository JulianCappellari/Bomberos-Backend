import { prisma } from "../../config/prisma";
import { cardinal, FWI_LEVELS, fwiLevel, runFwi, type FwiDay } from "../../utils/fwi";
import { OperationError } from "../operations/operations.schemas";

// Riesgo de incendio del dia para la ubicacion del cuartel. Datos meteorologicos de Open-Meteo (sin clave);
// el FWI se estima con 60 dias de serie. La referencia oficial sigue siendo el mapa provincial de IDECOR.
const SAMPACHO = { latitude: -33.384, longitude: -64.722, name: "Sampacho" };
const CACHE_MS = 30 * 60_000;
let cache: { at: number; value: unknown } | null = null;
let pending: Promise<unknown> | null = null;

type OpenMeteo = {
  current: { time: string; temperature_2m: number; relative_humidity_2m: number; wind_speed_10m: number; wind_gusts_10m: number; wind_direction_10m: number; precipitation: number };
  hourly: { time: string[]; temperature_2m: number[]; relative_humidity_2m: number[]; wind_speed_10m: number[] };
  daily: { time: string[]; precipitation_sum: number[] };
};

function nextDay(date: string) { const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); }

async function load() {
  const station = await prisma.station.findFirst({ orderBy: { createdAt: "asc" }, select: { name: true, latitude: true, longitude: true } }).catch(() => null);
  const place = station?.latitude && station?.longitude ? { latitude: station.latitude, longitude: station.longitude, name: station.name } : SAMPACHO;
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.search = new URLSearchParams({
    latitude: String(place.latitude), longitude: String(place.longitude), timezone: "America/Argentina/Cordoba", wind_speed_unit: "kmh",
    past_days: "60", forecast_days: "2",
    current: "temperature_2m,relative_humidity_2m,wind_speed_10m,wind_gusts_10m,wind_direction_10m,precipitation",
    hourly: "temperature_2m,relative_humidity_2m,wind_speed_10m",
    daily: "precipitation_sum",
  }).toString();
  const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`Open-Meteo respondió ${response.status}`);
  const data = (await response.json()) as OpenMeteo;

  // Serie diaria con los valores de las 13 h (mediodia solar aproximado) y la lluvia del dia.
  const today = data.current.time.slice(0, 10);
  const series: Array<{ date: string; day: FwiDay }> = [];
  data.daily.time.forEach((date, i) => {
    const index = data.hourly.time.indexOf(`${date}T13:00`);
    if (index < 0) return;
    const [temp, rh, wind] = [data.hourly.temperature_2m[index], data.hourly.relative_humidity_2m[index], data.hourly.wind_speed_10m[index]];
    if ([temp, rh, wind].some((v) => typeof v !== "number")) return;
    series.push({ date, day: { temp, rh: Math.min(100, Math.max(0, rh)), wind, rain: data.daily.precipitation_sum[i] ?? 0, month: Number(date.slice(5, 7)) } });
  });
  // Hoy: la serie hasta el dia actual. Manana: se agrega el dia de pronostico siguiente.
  const upToToday = series.filter((s) => s.date <= today).map((s) => s.day);
  const withTomorrow = series.filter((s) => s.date <= nextDay(today)).map((s) => s.day);
  const result = runFwi(upToToday.length ? upToToday : withTomorrow);
  const tomorrowResult = withTomorrow.length > upToToday.length ? runFwi(withTomorrow) : null;
  const tomorrowLevel = tomorrowResult ? fwiLevel(tomorrowResult.fwi) : 0;
  const level = fwiLevel(result.fwi);
  // Dias seguidos sin lluvia significativa (menos de 1 mm), contando desde ayer hacia atras.
  let dryDays = 0;
  for (let i = data.daily.time.indexOf(today) - 1; i >= 0; i--) { if ((data.daily.precipitation_sum[i] ?? 0) >= 1) break; dryDays++; }
  const from = data.current.wind_direction_10m;
  return {
    place: place.name, generatedAt: new Date().toISOString(), observedAt: data.current.time,
    level: FWI_LEVELS[level].id, levelLabel: FWI_LEVELS[level].label, levelIndex: level, levels: FWI_LEVELS.map((l) => l.label),
    fwi: Math.round(result.fwi * 10) / 10,
    tomorrow: tomorrowResult ? { date: nextDay(today), level: FWI_LEVELS[tomorrowLevel].id, levelLabel: FWI_LEVELS[tomorrowLevel].label, levelIndex: tomorrowLevel, fwi: Math.round(tomorrowResult.fwi * 10) / 10 } : null,
    current: { temperature: Math.round(data.current.temperature_2m), humidity: Math.round(data.current.relative_humidity_2m), wind: Math.round(data.current.wind_speed_10m), gusts: Math.round(data.current.wind_gusts_10m), windFrom: cardinal(from), spreadTowards: cardinal(from + 180), precipitation: data.current.precipitation },
    dryDays,
    codes: { ffmc: Math.round(result.ffmc * 10) / 10, dmc: Math.round(result.dmc * 10) / 10, dc: Math.round(result.dc), isi: Math.round(result.isi * 10) / 10, bui: Math.round(result.bui * 10) / 10 },
    source: "Open-Meteo (datos), cálculo FWI canadiense; niveles EFFIS. Referencia oficial: IDECOR.",
  };
}

export async function fireRisk() {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.value;
  pending ??= load().then((value) => { cache = { at: Date.now(), value }; return value; }).finally(() => { pending = null; });
  try { return await pending; }
  catch {
    // Sin conexion con el proveedor se devuelve el ultimo dato bueno, marcado como desactualizado.
    if (cache) return { ...(cache.value as object), stale: true };
    throw new OperationError(503, "No se pudo obtener el pronóstico ahora. Consultá el mapa oficial de IDECOR.");
  }
}

// Alerta temprana: desde las 18 h, si manana el riesgo es Alto o mayor se avisa una sola vez.
// Alto: jefatura y guardias. Muy alto o extremo: todo el personal.
export async function warnTomorrowFireRisk(now = new Date()) {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hourCycle: "h23", timeZone: "America/Argentina/Cordoba" }).format(now));
  if (hour < 18) return 0;
  let risk: Awaited<ReturnType<typeof load>>;
  try { risk = (await fireRisk()) as Awaited<ReturnType<typeof load>>; } catch { return 0; }
  const tomorrow = risk.tomorrow;
  if (!tomorrow || tomorrow.levelIndex < 2) return 0;
  const people = await prisma.user.findMany({ where: { isActive: true, isPendingApproval: false, deletedAt: null }, select: { id: true, role: true, profile: { select: { rank: true } } } });
  const command = (rank?: string | null) => ["oficial", "sub oficial", "guardia"].includes((rank ?? "").toLowerCase());
  const targets = people.filter((p) => tomorrow.levelIndex >= 3 || p.role === "ADMIN" || command(p.profile?.rank)).filter((p) => (p.profile?.rank ?? "").toLowerCase() !== "administrador");
  const created = await prisma.memberNotification.createMany({ data: targets.map((p) => ({ userId: p.id, dedupeKey: `fire-warning:${tomorrow.date}:${p.id}`, title: `Mañana riesgo de incendio ${tomorrow.levelLabel.toLowerCase()}`, href: "/dashboard", body: tomorrow.levelIndex >= 3 ? "Condiciones muy favorables para la propagación. Revisá tu disponibilidad y el estado de los equipos." : "Reforzar la vigilancia y tener los equipos listos." })), skipDuplicates: true });
  return created.count;
}
