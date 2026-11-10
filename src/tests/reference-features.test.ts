import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { createInventoryItemSchema, updateInventoryItemSchema, compartmentOrderSchema } from "../modules/equipment/equipment.schemas";
import { inspectionItemSchema } from "../modules/inspections/inspections.schemas";
import { departureSchema } from "../modules/fleet/departures.service";
import { sanitizeTaskPhotos } from "../modules/work/work-photos";
test("Etiquetas normalizadas, fechas validas y revision obligatoria", () => {
  assert.equal(createInventoryItemSchema.parse({ name: "Lanza", expectedQuantity: 1, labelCode: " m1-b1 " }).labelCode, "M1-B1");
  assert(!createInventoryItemSchema.safeParse({ name: "Lanza", expectedQuantity: 1, labelCode: "../x" }).success);
  assert(!updateInventoryItemSchema.safeParse({ notes: "No pisar versiones" }).success);
  assert(!compartmentOrderSchema.safeParse({ compartments: [{ id: "a", revision: 1 }, { id: "a", revision: 1 }] }).success);
});
test("Un material en otro lugar debe tener ubicacion y cantidad encontrada", () => {
  const item = { inventoryItemId: "i", result: "OK", observedQuantity: 1, foundElsewhere: true, foundLocation: "Baulera 2" };
  assert(inspectionItemSchema.safeParse(item).success);
  assert(!inspectionItemSchema.safeParse({ ...item, observedQuantity: 0 }).success);
  assert(!inspectionItemSchema.safeParse({ ...item, foundLocation: null }).success);
});
test("Acta de salida requiere cronologia, dotacion unica y encargado integrante", () => {
  const input = { operationKey: "1e81b729-e0a3-4d3b-9bb9-2dfb709107cd", assetId: "a", departedAt: "2026-01-01T09:00:00Z", returnedAt: "2026-01-01T10:00:00Z", purpose: "Capacitacion", notes: "Salida de entrenamiento", userIds: ["u"], leaderUserId: "u" };
  assert(departureSchema.safeParse(input).success);
  assert(!departureSchema.safeParse({ ...input, userIds: ["u", "u"] }).success);
  assert(!departureSchema.safeParse({ ...input, leaderUserId: "otro" }).success);
  assert(!departureSchema.safeParse({ ...input, returnedAt: input.departedAt }).success);
});
test("Fotos se recodifican a JPEG sin metadatos originales", async () => {
  const input = await sharp({ create: { width: 20, height: 20, channels: 3, background: "#fff" } }).withMetadata().png().toBuffer();
  const [photo] = await sanitizeTaskPhotos([input.toString("base64")]);
  const metadata = await sharp(photo.bytes).metadata();
  assert.equal(metadata.format, "jpeg"); assert.equal(metadata.exif, undefined); assert.equal(metadata.icc, undefined);
  assert.equal(photo.sha256.length, 64);
});
test("Evidencia rechaza SVG, documentos y archivos falsificados", async () => {
  await assert.rejects(sanitizeTaskPhotos([Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString("base64")]));
  await assert.rejects(sanitizeTaskPhotos([Buffer.from([255, 216, 255, 0]).toString("base64")]));
});
