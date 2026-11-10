"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const sharp_1 = __importDefault(require("sharp"));
const equipment_schemas_1 = require("../modules/equipment/equipment.schemas");
const inspections_schemas_1 = require("../modules/inspections/inspections.schemas");
const departures_service_1 = require("../modules/fleet/departures.service");
const work_photos_1 = require("../modules/work/work-photos");
(0, node_test_1.default)("Etiquetas normalizadas, fechas validas y revision obligatoria", () => {
    strict_1.default.equal(equipment_schemas_1.createInventoryItemSchema.parse({ name: "Lanza", expectedQuantity: 1, labelCode: " m1-b1 " }).labelCode, "M1-B1");
    (0, strict_1.default)(!equipment_schemas_1.createInventoryItemSchema.safeParse({ name: "Lanza", expectedQuantity: 1, labelCode: "../x" }).success);
    (0, strict_1.default)(!equipment_schemas_1.updateInventoryItemSchema.safeParse({ notes: "No pisar versiones" }).success);
    (0, strict_1.default)(!equipment_schemas_1.compartmentOrderSchema.safeParse({ compartments: [{ id: "a", revision: 1 }, { id: "a", revision: 1 }] }).success);
});
(0, node_test_1.default)("Un material en otro lugar debe tener ubicacion y cantidad encontrada", () => {
    const item = { inventoryItemId: "i", result: "OK", observedQuantity: 1, foundElsewhere: true, foundLocation: "Baulera 2" };
    (0, strict_1.default)(inspections_schemas_1.inspectionItemSchema.safeParse(item).success);
    (0, strict_1.default)(!inspections_schemas_1.inspectionItemSchema.safeParse({ ...item, observedQuantity: 0 }).success);
    (0, strict_1.default)(!inspections_schemas_1.inspectionItemSchema.safeParse({ ...item, foundLocation: null }).success);
});
(0, node_test_1.default)("Acta de salida requiere cronologia, dotacion unica y encargado integrante", () => {
    const input = { operationKey: "1e81b729-e0a3-4d3b-9bb9-2dfb709107cd", assetId: "a", departedAt: "2026-01-01T09:00:00Z", returnedAt: "2026-01-01T10:00:00Z", purpose: "Capacitacion", notes: "Salida de entrenamiento", userIds: ["u"], leaderUserId: "u" };
    (0, strict_1.default)(departures_service_1.departureSchema.safeParse(input).success);
    (0, strict_1.default)(!departures_service_1.departureSchema.safeParse({ ...input, userIds: ["u", "u"] }).success);
    (0, strict_1.default)(!departures_service_1.departureSchema.safeParse({ ...input, leaderUserId: "otro" }).success);
    (0, strict_1.default)(!departures_service_1.departureSchema.safeParse({ ...input, returnedAt: input.departedAt }).success);
});
(0, node_test_1.default)("Fotos se recodifican a JPEG sin metadatos originales", async () => {
    const input = await (0, sharp_1.default)({ create: { width: 20, height: 20, channels: 3, background: "#fff" } }).withMetadata().png().toBuffer();
    const [photo] = await (0, work_photos_1.sanitizeTaskPhotos)([input.toString("base64")]);
    const metadata = await (0, sharp_1.default)(photo.bytes).metadata();
    strict_1.default.equal(metadata.format, "jpeg");
    strict_1.default.equal(metadata.exif, undefined);
    strict_1.default.equal(metadata.icc, undefined);
    strict_1.default.equal(photo.sha256.length, 64);
});
(0, node_test_1.default)("Evidencia rechaza SVG, documentos y archivos falsificados", async () => {
    await strict_1.default.rejects((0, work_photos_1.sanitizeTaskPhotos)([Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString("base64")]));
    await strict_1.default.rejects((0, work_photos_1.sanitizeTaskPhotos)([Buffer.from([255, 216, 255, 0]).toString("base64")]));
});
