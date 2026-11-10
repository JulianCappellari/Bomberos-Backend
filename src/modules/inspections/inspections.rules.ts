export type CheckedMaterial = {
  observedQuantity: number;
  result: "OK" | "MISSING" | "DAMAGED";
  observations?: string | null;
};

export function validateMaterial(item: CheckedMaterial, expectedQuantity: number) {
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

export function inspectionTimestamp(date: string, time: string) {
  return new Date(`${date}T${time}:00-03:00`).getTime();
}
