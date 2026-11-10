"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateMaterial = validateMaterial;
exports.inspectionTimestamp = inspectionTimestamp;
function validateMaterial(item, expectedQuantity) {
    if (!Number.isInteger(item.observedQuantity) || item.observedQuantity < 0) {
        throw new Error("La cantidad encontrada debe ser un entero no negativo");
    }
    if (item.result === "OK" && item.observedQuantity < expectedQuantity) {
        throw new Error("No puede marcarse OK con materiales faltantes");
    }
    if (item.result === "MISSING" && item.observedQuantity >= expectedQuantity) {
        throw new Error("La cantidad encontrada no indica un faltante");
    }
    if (item.result === "DAMAGED" && item.observedQuantity === 0) {
        throw new Error("Un material ausente debe registrarse como faltante");
    }
    if (item.result !== "OK" && !item.observations?.trim()) {
        throw new Error("Los faltantes y danos deben incluir una novedad");
    }
}
function inspectionTimestamp(date, time) {
    return new Date(`${date}T${time}:00-03:00`).getTime();
}
