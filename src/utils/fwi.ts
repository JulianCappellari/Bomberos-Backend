// Indice meteorologico de peligro de incendio (FWI) del sistema canadiense, ecuaciones de Van Wagner (1987).
// Se calcula dia a dia con temperatura y humedad del mediodia, viento y lluvia de 24 h. Necesita una serie
// previa (arranque con valores estandar) para que los codigos de humedad del combustible se estabilicen.
export type FwiDay = { temp: number; rh: number; wind: number; rain: number; month: number };
export type FwiCodes = { ffmc: number; dmc: number; dc: number };

// Factores de duracion del dia para el hemisferio sur (latitud al sur de 30 S).
const DMC_DAY_LENGTH_SOUTH = [11.5, 10.5, 9.2, 7.9, 6.8, 6.2, 6.5, 7.4, 8.7, 10.0, 11.2, 11.8];
const DC_DAY_LENGTH_SOUTH = [6.4, 5.0, 2.4, 0.4, -1.6, -1.6, -1.6, -1.6, -1.6, 0.9, 3.8, 5.8];

export function nextFfmc(prev: number, { temp: t, rh, wind: ws, rain }: FwiDay) {
  let mo = (147.2 * (101 - prev)) / (59.5 + prev);
  if (rain > 0.5) {
    const rf = rain - 0.5;
    const base = 42.5 * rf * Math.exp(-100 / (251 - mo)) * (1 - Math.exp(-6.93 / rf));
    mo = mo > 150 ? mo + base + 0.0015 * (mo - 150) ** 2 * Math.sqrt(rf) : mo + base;
    mo = Math.min(mo, 250);
  }
  const ed = 0.942 * rh ** 0.679 + 11 * Math.exp((rh - 100) / 10) + 0.18 * (21.1 - t) * (1 - Math.exp(-0.115 * rh));
  let m = mo;
  if (mo > ed) {
    const ko = 0.424 * (1 - (rh / 100) ** 1.7) + 0.0694 * Math.sqrt(ws) * (1 - (rh / 100) ** 8);
    m = ed + (mo - ed) * 10 ** (-(ko * 0.581 * Math.exp(0.0365 * t)));
  } else {
    const ew = 0.618 * rh ** 0.753 + 10 * Math.exp((rh - 100) / 10) + 0.18 * (21.1 - t) * (1 - Math.exp(-0.115 * rh));
    if (mo < ew) {
      const k1 = 0.424 * (1 - ((100 - rh) / 100) ** 1.7) + 0.0694 * Math.sqrt(ws) * (1 - ((100 - rh) / 100) ** 8);
      m = ew - (ew - mo) * 10 ** (-(k1 * 0.581 * Math.exp(0.0365 * t)));
    }
  }
  return Math.min(101, Math.max(0, (59.5 * (250 - m)) / (147.2 + m)));
}

export function nextDmc(prev: number, { temp, rh, rain, month }: FwiDay) {
  let dmc = prev;
  if (rain > 1.5) {
    const re = 0.92 * rain - 1.27;
    const mo = 20 + Math.exp(5.6348 - prev / 43.43);
    const b = prev <= 33 ? 100 / (0.5 + 0.3 * prev) : prev <= 65 ? 14 - 1.3 * Math.log(prev) : 6.2 * Math.log(prev) - 17.2;
    const mr = mo + (1000 * re) / (48.77 + b * re);
    dmc = Math.max(0, 244.72 - 43.43 * Math.log(mr - 20));
  }
  const t = Math.max(temp, -1.1);
  const rk = 1.894 * (t + 1.1) * (100 - rh) * DMC_DAY_LENGTH_SOUTH[month - 1] * 1e-4;
  return Math.max(0, dmc + rk);
}

export function nextDc(prev: number, { temp, rain, month }: FwiDay) {
  let dc = prev;
  if (rain > 2.8) {
    const rd = 0.83 * rain - 1.27;
    const qr = 800 * Math.exp(-prev / 400) + 3.937 * rd;
    dc = Math.max(0, 400 * Math.log(800 / qr));
  }
  const t = Math.max(temp, -2.8);
  const pe = Math.max(0, (0.36 * (t + 2.8) + DC_DAY_LENGTH_SOUTH[month - 1]) / 2);
  return dc + pe;
}

export function isi(ffmc: number, wind: number) {
  const fm = (147.2 * (101 - ffmc)) / (59.5 + ffmc);
  const sf = 19.115 * Math.exp(-0.1386 * fm) * (1 + fm ** 5.31 / 4.93e7);
  return sf * Math.exp(0.05039 * wind);
}

export function bui(dmc: number, dc: number) {
  if (dmc === 0) return 0;
  const value = dmc <= 0.4 * dc ? (0.8 * dmc * dc) / (dmc + 0.4 * dc) : dmc - (1 - (0.8 * dc) / (dmc + 0.4 * dc)) * (0.92 + (0.0114 * dmc) ** 1.7);
  return Math.max(0, value);
}

export function fwi(isiValue: number, buiValue: number) {
  const bb = buiValue <= 80 ? 0.1 * isiValue * (0.626 * buiValue ** 0.809 + 2) : 0.1 * isiValue * (1000 / (25 + 108.64 * Math.exp(-0.023 * buiValue)));
  return bb <= 1 ? bb : Math.exp(2.72 * (0.434 * Math.log(bb)) ** 0.647);
}

/** Recorre la serie diaria y devuelve los codigos y el FWI del ultimo dia. */
export function runFwi(days: FwiDay[], start: FwiCodes = { ffmc: 85, dmc: 6, dc: 15 }) {
  let codes = { ...start };
  let last = { ...codes, isi: 0, bui: 0, fwi: 0 };
  for (const day of days) {
    codes = { ffmc: nextFfmc(codes.ffmc, day), dmc: nextDmc(codes.dmc, day), dc: nextDc(codes.dc, day) };
    const i = isi(codes.ffmc, day.wind), b = bui(codes.dmc, codes.dc);
    last = { ...codes, isi: i, bui: b, fwi: fwi(i, b) };
  }
  return last;
}

// Cinco niveles, con los umbrales del sistema europeo EFFIS (referencia publicada y ampliamente usada).
export const FWI_LEVELS = [
  { id: "LOW", label: "Bajo", max: 5.2 },
  { id: "MODERATE", label: "Moderado", max: 11.2 },
  { id: "HIGH", label: "Alto", max: 21.3 },
  { id: "VERY_HIGH", label: "Muy alto", max: 38 },
  { id: "EXTREME", label: "Extremo", max: Infinity },
] as const;
export function fwiLevel(value: number) { return FWI_LEVELS.findIndex((level) => value < level.max); }

const CARDINALS = ["Norte", "Noreste", "Este", "Sureste", "Sur", "Suroeste", "Oeste", "Noroeste"];
export function cardinal(degrees: number) { return CARDINALS[Math.round((((degrees % 360) + 360) % 360) / 45) % 8]; }
