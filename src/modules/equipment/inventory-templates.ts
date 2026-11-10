// Suggestions only: equipment requirements must be approved for each actual unit.
export const inventoryTemplates = {
  ENGINE: { name: "Autobomba - base editable", compartments: [
    { name: "Cabina", items: ["Linterna", "Chaleco reflectivo"] },
    { name: "Baulera 1", items: ["Manguera", "Lanza", "Acople"] },
    { name: "Baulera 2", items: ["Hacha", "Barreta", "Caja de herramientas"] },
    { name: "Techo", items: ["Escalera"] },
  ] },
  SUPPORT: { name: "Apoyo - base editable", compartments: [
    { name: "Cabina", items: ["Linterna", "Chaleco reflectivo"] },
    { name: "Caja de carga", items: ["Cono de senalizacion", "Caja de herramientas"] },
  ] },
} as const;
