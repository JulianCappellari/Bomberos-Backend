"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fireRisk = fireRisk;
const prisma_1 = require("../../config/prisma");
const fwi_1 = require("../../utils/fwi");
const operations_schemas_1 = require("../operations/operations.schemas");
// Riesgo de incendio del dia para la ubicacion del cuartel. Datos meteorologicos de Open-Meteo (sin clave);
// el FWI se estima con 60 dias de serie. La referencia oficial sigue siendo el mapa provincial de IDECOR.
const SAMPACHO = { latitude: -33.384, longitude: -64.722, name: "Sampacho" };
const CACHE_MS = 30 * 60000;
let cache = null;
let pending = null;
async function load() {
    const station = await prisma_1.prisma.station.findFirst({ orderBy: { createdAt: "asc" }, select: { name: true, latitude: true, longitude: true } }).catch(() => null);
    const place = station?.latitude && station?.longitude ? { latitude: station.latitude, longitude: station.longitude, name: station.name } : SAMPACHO;
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.search = new URLSearchParams({
        latitude: String(place.latitude), longitude: String(place.longitude), timezone: "America/Argentina/Cordoba", wind_speed_unit: "kmh",
        past_days: "60", forecast_days: "1",
        current: "temperature_2m,relative_humidity_2m,wind_speed_10m,wind_gusts_10m,wind_direction_10m,precipitation",
        hourly: "temperature_2m,relative_humidity_2m,wind_speed_10m",
        daily: "precipitation_sum",
    }).toString();
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!response.ok)
        throw new Error(`Open-Meteo respondió ${response.status}`);
    const data = (await response.json());
    // Serie diaria con los valores de las 13 h (mediodia solar aproximado) y la lluvia del dia.
    const days = [];
    data.daily.time.forEach((date, i) => {
        const index = data.hourly.time.indexOf(`${date}T13:00`);
        if (index < 0)
            return;
        const [temp, rh, wind] = [data.hourly.temperature_2m[index], data.hourly.relative_humidity_2m[index], data.hourly.wind_speed_10m[index]];
        if ([temp, rh, wind].some((v) => typeof v !== "number"))
            return;
        days.push({ temp, rh: Math.min(100, Math.max(0, rh)), wind, rain: data.daily.precipitation_sum[i] ?? 0, month: Number(date.slice(5, 7)) });
    });
    const result = (0, fwi_1.runFwi)(days);
    const level = (0, fwi_1.fwiLevel)(result.fwi);
    // Dias seguidos sin lluvia significativa (menos de 1 mm), contando desde ayer hacia atras.
    let dryDays = 0;
    for (let i = data.daily.time.length - 2; i >= 0; i--) {
        if ((data.daily.precipitation_sum[i] ?? 0) >= 1)
            break;
        dryDays++;
    }
    const from = data.current.wind_direction_10m;
    return {
        place: place.name, generatedAt: new Date().toISOString(), observedAt: data.current.time,
        level: fwi_1.FWI_LEVELS[level].id, levelLabel: fwi_1.FWI_LEVELS[level].label, levelIndex: level, levels: fwi_1.FWI_LEVELS.map((l) => l.label),
        fwi: Math.round(result.fwi * 10) / 10,
        current: { temperature: Math.round(data.current.temperature_2m), humidity: Math.round(data.current.relative_humidity_2m), wind: Math.round(data.current.wind_speed_10m), gusts: Math.round(data.current.wind_gusts_10m), windFrom: (0, fwi_1.cardinal)(from), spreadTowards: (0, fwi_1.cardinal)(from + 180), precipitation: data.current.precipitation },
        dryDays,
        codes: { ffmc: Math.round(result.ffmc * 10) / 10, dmc: Math.round(result.dmc * 10) / 10, dc: Math.round(result.dc), isi: Math.round(result.isi * 10) / 10, bui: Math.round(result.bui * 10) / 10 },
        source: "Open-Meteo (datos), cálculo FWI canadiense; niveles EFFIS. Referencia oficial: IDECOR.",
    };
}
async function fireRisk() {
    if (cache && Date.now() - cache.at < CACHE_MS)
        return cache.value;
    pending ?? (pending = load().then((value) => { cache = { at: Date.now(), value }; return value; }).finally(() => { pending = null; }));
    try {
        return await pending;
    }
    catch {
        // Sin conexion con el proveedor se devuelve el ultimo dato bueno, marcado como desactualizado.
        if (cache)
            return { ...cache.value, stale: true };
        throw new operations_schemas_1.OperationError(503, "No se pudo obtener el pronóstico ahora. Consultá el mapa oficial de IDECOR.");
    }
}
