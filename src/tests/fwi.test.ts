import { test } from "node:test";
import assert from "node:assert/strict";
import { cardinal, fwiLevel, runFwi } from "../utils/fwi";

test("FWI: sequía calurosa y ventosa da riesgo extremo; invierno lluvioso, bajo", () => {
  const dry = runFwi(Array.from({ length: 60 }, () => ({ temp: 35, rh: 15, wind: 30, rain: 0, month: 1 })));
  const wet = runFwi(Array.from({ length: 60 }, () => ({ temp: 12, rh: 90, wind: 5, rain: 8, month: 7 })));
  assert.ok(dry.fwi > 38, `FWI seco ${dry.fwi}`);
  assert.equal(fwiLevel(dry.fwi), 4);
  assert.ok(wet.fwi < 5.2, `FWI húmedo ${wet.fwi}`);
  assert.equal(fwiLevel(wet.fwi), 0);
  assert.ok(dry.ffmc > 90 && dry.ffmc <= 101);
});

test("FWI: un día de referencia de Van Wagner queda en el rango publicado", () => {
  // Ejemplo clásico: FFMC 85, DMC 6, DC 15 y día 17 °C, 42 %, 25 km/h, sin lluvia.
  const r = runFwi([{ temp: 17, rh: 42, wind: 25, rain: 0, month: 4 }]);
  assert.ok(Math.abs(r.ffmc - 87.7) < 0.3, `FFMC ${r.ffmc}`);
  assert.ok(r.isi > 8 && r.isi < 12, `ISI ${r.isi}`);
});

test("Dirección del viento en puntos cardinales", () => {
  assert.equal(cardinal(0), "Norte"); assert.equal(cardinal(180), "Sur"); assert.equal(cardinal(225), "Suroeste"); assert.equal(cardinal(359), "Norte");
});
