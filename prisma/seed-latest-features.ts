import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import sharp from "sharp";
import { stationDate } from "../src/utils/station-time";
import { normalizeLicenseClass } from "../src/utils/license-classes";

// Paso 7 del seed: funciones nuevas (cuentas de guardia propias, licencias por clase y moviles,
// deposito de vestimenta y materiales, encuestas, fotos y links, Comision Directiva y constancia).
// Igual que el resto del seed: identificadores fijos y altas "solo si no existen", para no pisar lo
// que se haya editado probando la app. Los datos nuevos de registros existentes se completan una vez.
const id = (key: string) => `demo_v2_${key}`;
const lf = (key: string) => id(`latest_${key}`);

export async function seedLatestFeatures(tx: Prisma.TransactionClient, passwordHash: string, reference: Date) {
  const anchor = new Date(stationDate(reference) + "T00:00:00Z");
  const day = (offset: number) => new Date(anchor.getTime() + offset * 86_400_000);
  const at = (offset: number, hour: number, minute = 0) => new Date(`${day(offset).toISOString().slice(0, 10)}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00-03:00`);
  const iso = (offset: number) => day(offset).toISOString().slice(0, 10);
  const audit = (key: string, actor: string, action: string, entityType: string, entityId: string, metadata: Prisma.InputJsonValue, createdAt = reference) =>
    tx.auditLog.upsert({ where: { id: lf(`audit_${key}`) }, update: {}, create: { id: lf(`audit_${key}`), actorUserId: id(actor), action, entityType, entityId, metadata, createdAt } });

  // ---------------------------------------------------------------------------
  // 1. Cuentas de guardia propias (otro usuario y contraseña) vinculadas a la persona.
  // ---------------------------------------------------------------------------
  for (const owner of ["bombero", "sofia"]) {
    const person = await tx.user.findUniqueOrThrow({ where: { id: id(owner) }, include: { profile: true } });
    await tx.user.upsert({ where: { id: id(`guardia_${owner}`) }, update: {}, create: {
      id: id(`guardia_${owner}`), username: `demo.guardia_${owner}`, email: `guardia_${owner}@bomberos.demo.invalid`, role: "FIREFIGHTER", passwordHash, guardForUserId: person.id,
      profile: { create: { fullName: `Guardia · ${person.profile?.fullName ?? owner}`.slice(0, 120), rank: "Guardia", dni: `G-${person.profile?.dni ?? owner}`.slice(0, 20), badge: `G-${person.profile?.badge ?? owner}`.slice(0, 30), phone: person.profile?.phone } },
    } });
    await audit(`guard_account_${owner}`, "admin", "GUARD_ACCOUNT_CREATED", "User", id(`guardia_${owner}`), { ownerUserId: person.id, username: `demo.guardia_${owner}`, reason: "[DEMO] Cuenta de guardia propia para la prueba" });
  }

  // ---------------------------------------------------------------------------
  // 2. Licencia que exige cada movil, segun su porte (Disposicion ANSV 20/2019: clase del vehiculo + D.4).
  // ---------------------------------------------------------------------------
  const fleetCategory = ["HEAVY", "MEDIUM", "EXTRA_HEAVY", "LIGHT", "LIGHT", "MEDIUM"]; // M-14, M-8, M-21, M-4, M-2, M-1
  for (const [index, category] of fleetCategory.entries()) await tx.vehicle.updateMany({ where: { id: id(`vehicle_${index}`), licenseCategory: "UNSET" }, data: { licenseCategory: category } });

  // ---------------------------------------------------------------------------
  // 3. Licencias por clase, con fechas propias. Un caso de cada situacion:
  //    bombero: todo hasta 24.000 kg · nicolas: todos los moviles · lucia: solo livianos
  //    sofia: le falta D.4 (tiene B.1 y C.1 entre sus dos licencias) · mateo: D.4 vencida · camila: licencia vencida.
  // ---------------------------------------------------------------------------
  const licenses: Record<string, Array<{ code: string; grantedOn: string; expiresOn?: string }>> = {
    bombero: [{ code: "B.1", grantedOn: iso(-3000) }, { code: "C.1", grantedOn: iso(-1500) }, { code: "C.2", grantedOn: iso(-700) }, { code: "D.4", grantedOn: iso(-700) }],
    nicolas: [{ code: "B.1", grantedOn: iso(-4000) }, { code: "C.3", grantedOn: iso(-900) }, { code: "D.4", grantedOn: iso(-900) }],
    sofia: [{ code: "B.1", grantedOn: iso(-2000) }],
    lucia: [{ code: "B.1", grantedOn: iso(-1200) }, { code: "D.4", grantedOn: iso(-500) }],
    mateo: [{ code: "B.1", grantedOn: iso(-1800) }, { code: "C.1", grantedOn: iso(-900) }, { code: "D.4", grantedOn: iso(-1100), expiresOn: iso(-10) }],
    camila: [{ code: "B.1", grantedOn: iso(-2500) }, { code: "D.4", grantedOn: iso(-600) }],
  };
  for (const [key, classes] of Object.entries(licenses)) {
    await tx.personalDeclaration.updateMany({ where: { id: id(`extended_license_${key}`), licenseClassDetails: { equals: Prisma.DbNull } }, data: {
      licenseClasses: classes.map((c) => c.code), licenseClassDetails: classes.map((c) => ({ code: c.code, grantedOn: c.grantedOn, expiresOn: c.expiresOn ?? null })),
      details: "[DEMO] Licencia ficticia con clases y fechas por clase", issuer: "[DEMO] Municipalidad de Sampacho",
    } });
  }
  // Bases demo anteriores: licencias y habilitaciones con el formato viejo ("B1") pasan al oficial ("B.1").
  for (const row of await tx.personalDeclaration.findMany({ where: { category: "DRIVER_LICENSE" }, select: { id: true, licenseClasses: true } })) {
    const normalized = row.licenseClasses.map(normalizeLicenseClass);
    if (normalized.join() !== row.licenseClasses.join()) await tx.personalDeclaration.update({ where: { id: row.id }, data: { licenseClasses: normalized } });
  }
  for (const row of await tx.vehicleDriverAuthorization.findMany({ where: { requiredClass: { in: ["B1", "C1", "C2", "C3", "E1", "D4"] } } })) {
    await tx.vehicleDriverAuthorization.update({ where: { assetId_userId: { assetId: row.assetId, userId: row.userId } }, data: { requiredClass: `${row.requiredClass[0]}.${row.requiredClass.slice(1)}` } });
  }

  // ---------------------------------------------------------------------------
  // 4. Deposito de vestimenta y materiales (encargada: demo.lucia, permiso PPE).
  // ---------------------------------------------------------------------------
  type Mov = [string, "IN" | "OUT" | "ASSIGN" | "LOSS" | "ADJUST", number, string, { user?: string; vehicle?: number; request?: string }?];
  const items: Array<{ key: string; name: string; category: string; size?: string; unit?: string; min: number; location: string; moves: Mov[] }> = [
    { key: "remera_m", name: "Remera institucional", category: "VESTIMENTA", size: "M", min: 4, location: "Placard de vestimenta", moves: [["a", "IN", 10, "Compra anual de remeras"], ["b", "ASSIGN", 2, "Entrega por ingreso", { user: "bombero" }], ["c", "ASSIGN", 2, "Reposición por desgaste", { user: "sofia" }]] },
    { key: "remera_l", name: "Remera institucional", category: "VESTIMENTA", size: "L", min: 4, location: "Placard de vestimenta", moves: [["a", "IN", 6, "Compra anual de remeras"], ["b", "ASSIGN", 3, "Entrega a dotación nueva", { user: "nicolas" }], ["c", "LOSS", 1, "Faltante en el recuento mensual"]] },
    { key: "campera_l", name: "Campera de abrigo", category: "VESTIMENTA", size: "L", min: 2, location: "Placard de vestimenta", moves: [["a", "IN", 4, "Donación de la Cooperativa"], ["b", "ASSIGN", 1, "Entrega por invierno", { user: "camila" }]] },
    { key: "guantes_9", name: "Guantes de rescate", category: "EPP", size: "9", unit: "par", min: 4, location: "Pañol EPP", moves: [["a", "IN", 3, "Compra de reposición"], ["b", "ASSIGN", 2, "Entrega para rescate vehicular", { user: "bombero" }], ["c", "LOSS", 1, "Guantes rotos en intervención"]] },
    { key: "capucha", name: "Capucha ignífuga", category: "EPP", min: 3, location: "Pañol EPP", moves: [["a", "IN", 8, "Compra de equipamiento"]] },
    { key: "foco_h4", name: "Foco halógeno H4", category: "MOVIL", min: 2, location: "Depósito, estante 3", moves: [["a", "IN", 3, "Compra en repuestera"], ["b", "ASSIGN", 1, "Cambio de óptica delantera", { vehicle: 0 }], ["c", "ASSIGN", 1, "Entrega del pedido de material", { vehicle: 1, request: "foco_m8_entregado" }]] },
    { key: "aceite", name: "Aceite 15W40", category: "MOVIL", unit: "bidón", min: 2, location: "Depósito, estante 1", moves: [["a", "IN", 6, "Compra para service"], ["b", "OUT", 1, "Entrega del pedido de material", { request: "aceite_m1" }]] },
    { key: "lavandina", name: "Lavandina 5 L", category: "LIMPIEZA", unit: "bidón", min: 3, location: "Depósito de limpieza", moves: [["a", "IN", 6, "Compra mensual"], ["b", "OUT", 2, "Limpieza de la sala de guardia"]] },
    { key: "cinta", name: "Cinta de peligro", category: "CUARTEL", unit: "rollo", min: 3, location: "Depósito, estante 2", moves: [["a", "IN", 12, "Compra de insumos"], ["b", "ADJUST", 10, "Recuento mensual"]] },
    { key: "linterna", name: "Linterna recargable", category: "HERRAMIENTA", min: 2, location: "Pañol de herramientas", moves: [["a", "IN", 4, "Compra de equipamiento"], ["b", "ASSIGN", 2, "Equipamiento de M-14", { vehicle: 0 }]] },
  ];
  // Pedidos de materiales (oficial, sub oficial, guardia): uno por cada estado.
  const requests: Array<{ key: string; title: string; details?: string; vehicle?: number; quantity: number; priority: "NORMAL" | "URGENT"; status: string; by: string; notes?: string; item?: string; offset: number }> = [
    { key: "foco_m8", title: "Foco para el camión 8", details: "Se quemó la óptica delantera derecha del M-8.", vehicle: 1, quantity: 1, priority: "URGENT", status: "PENDING", by: "guardia", offset: 0 },
    { key: "baterias_m14", title: "Baterías para linternas del M-14", vehicle: 0, quantity: 4, priority: "NORMAL", status: "APPROVED", by: "oficial", notes: "Se compran esta semana.", offset: -2 },
    { key: "manguera_m21", title: "Manguera de 45 mm x 25 m", details: "Reposición de un tramo pinchado.", vehicle: 2, quantity: 2, priority: "NORMAL", status: "ORDERED", by: "subjefe", notes: "Encargada al proveedor, llega en 10 días.", offset: -5 },
    { key: "foco_m8_entregado", title: "Foco H4 para el M-8 (pedido anterior)", vehicle: 1, quantity: 1, priority: "URGENT", status: "DELIVERED", by: "guardia", notes: "Entregado del depósito.", item: "foco_h4", offset: -12 },
    { key: "aceite_m1", title: "Aceite para el service del M-1", vehicle: 5, quantity: 1, priority: "NORMAL", status: "DELIVERED", by: "operador", notes: "Retirado del depósito.", item: "aceite", offset: -9 },
    { key: "pintura", title: "Pintura para el portón", quantity: 1, priority: "NORMAL", status: "REJECTED", by: "operador", notes: "Se hace con el presupuesto de obras del cuartel.", offset: -7 },
    { key: "escoba", title: "Escobas para el galpón", quantity: 3, priority: "NORMAL", status: "CANCELLED", by: "operador", offset: -4 },
  ];
  for (const r of requests) {
    await tx.materialRequest.upsert({ where: { id: lf(`matreq_${r.key}`) }, update: {}, create: {
      id: lf(`matreq_${r.key}`), title: `[DEMO] ${r.title}`, details: r.details ?? null, destination: r.vehicle === undefined ? "STATION" : "VEHICLE", vehicleId: r.vehicle === undefined ? null : id(`vehicle_${r.vehicle}`),
      quantity: r.quantity, priority: r.priority, status: r.status, requestedByUserId: id(r.by), createdAt: at(r.offset, 10), handledByUserId: ["PENDING", "CANCELLED"].includes(r.status) ? null : id("lucia"),
      handledAt: ["PENDING", "CANCELLED"].includes(r.status) ? null : at(r.offset + 1, 9), handlerNotes: r.notes ?? null,
    } });
  }
  for (const [order, item] of items.entries()) {
    let balance = 0;
    const rows = item.moves.map(([key, type, quantity, reason, extra], index) => {
      const before = balance; balance = type === "IN" ? balance + quantity : type === "ADJUST" ? quantity : balance - quantity;
      return { id: lf(`supmov_${item.key}_${key}`), itemId: lf(`supply_${item.key}`), type, quantity: type === "ADJUST" ? Math.abs(balance - before) : quantity, balanceAfter: balance, reason: `[DEMO] ${reason}`,
        assignedUserId: extra?.user ? id(extra.user) : null, vehicleId: extra?.vehicle === undefined ? null : id(`vehicle_${extra.vehicle}`), requestId: extra?.request ? lf(`matreq_${extra.request}`) : null,
        createdByUserId: id("lucia"), createdAt: at(-20 + order + index * 4, 11) };
    });
    await tx.supplyItem.upsert({ where: { id: lf(`supply_${item.key}`) }, update: {}, create: {
      id: lf(`supply_${item.key}`), name: `[DEMO] ${item.name}`, category: item.category, size: item.size ?? null, unit: item.unit ?? "unidad", quantity: balance, minQuantity: item.min, location: item.location, createdAt: at(-25, 9),
    } });
    for (const row of rows) await tx.supplyMovement.upsert({ where: { id: row.id }, update: {}, create: row });
  }
  // Los pedidos entregados quedan vinculados al articulo del deposito.
  for (const r of requests.filter((x) => x.item)) await tx.materialRequest.updateMany({ where: { id: lf(`matreq_${r.key}`), supplyItemId: null }, data: { supplyItemId: lf(`supply_${r.item}`) } });
  await audit("supply_low_stock", "lucia", "SUPPLY_LOSS", "SupplyItem", lf("supply_guantes_9"), { before: 1, after: 0, quantity: 1, reason: "[DEMO] Guantes rotos en intervención" });
  await tx.memberNotification.upsert({ where: { id: lf("notice_matreq") }, update: {}, create: { id: lf("notice_matreq"), userId: id("lucia"), title: "URGENTE · Pedido de material: [DEMO] Foco para el camión 8", href: "/supplies?tab=requests", body: "Para el móvil M-8. Cantidad: 1.", createdAt: at(0, 10) } });

  // ---------------------------------------------------------------------------
  // 5. Comunicaciones: encuestas (una abierta y una cerrada), foto, link y aviso para la Comision.
  // ---------------------------------------------------------------------------
  const message = (key: string, author: string, body: string, audience: string, offset: number, extra: Partial<Prisma.ChatMessageUncheckedCreateInput> = {}) =>
    tx.chatMessage.upsert({ where: { id: lf(`chat_${key}`) }, update: {}, create: { id: lf(`chat_${key}`), authorUserId: id(author), body, audience, createdAt: at(offset, 18), ...extra } });
  await message("poll_rcp", "subjefe", "[DEMO] ¿Qué día hacemos la capacitación de RCP?", "ALL", -1);
  await tx.chatPoll.upsert({ where: { id: lf("poll_rcp") }, update: {}, create: { id: lf("poll_rcp"), messageId: lf("chat_poll_rcp"), allowMultiple: false, options: { create: ["Martes 20 h", "Jueves 20 h", "Sábado 10 h"].map((text, position) => ({ id: lf(`poll_rcp_${position}`), text, position })) } } });
  for (const [user, option] of [["bombero", 1], ["sofia", 1], ["nicolas", 2], ["camila", 0], ["mateo", 1]] as const) {
    await tx.chatPollVote.upsert({ where: { optionId_userId: { optionId: lf(`poll_rcp_${option}`), userId: id(user) } }, update: {}, create: { pollId: lf("poll_rcp"), optionId: lf(`poll_rcp_${option}`), userId: id(user), votedAt: at(-1, 19 + option) } });
  }
  await message("poll_compras", "subjefe", "[DEMO] ¿Qué compras priorizamos este mes? (podés elegir varias)", "COMMAND", -6);
  await tx.chatPoll.upsert({ where: { id: lf("poll_compras") }, update: {}, create: { id: lf("poll_compras"), messageId: lf("chat_poll_compras"), allowMultiple: true, closedAt: at(-3, 9), closedByUserId: id("subjefe"), options: { create: ["Mangueras de 45 mm", "Guantes de rescate", "Baterías y linternas", "Pintura del cuartel"].map((text, position) => ({ id: lf(`poll_compras_${position}`), text, position })) } } });
  for (const [user, option] of [["oficial", 0], ["oficial", 1], ["operador", 1], ["operador", 2], ["subjefe", 1]] as const) {
    await tx.chatPollVote.upsert({ where: { optionId_userId: { optionId: lf(`poll_compras_${option}`), userId: id(user) } }, update: {}, create: { pollId: lf("poll_compras"), optionId: lf(`poll_compras_${option}`), userId: id(user), votedAt: at(-5, 10) } });
  }
  await message("link_licencias", "oficial", "[DEMO] Para cargar bien las licencias: el camión de bomberos exige la clase del vehículo (C.1 o C.2) más la D.4 de emergencias. Detalle oficial:", "ALL", -2, { links: ["https://www.argentina.gob.ar/seguridadvial/licencianacional/clasesysubclases"] });
  if (!await tx.chatAttachment.findFirst({ where: { messageId: lf("chat_foto_porton") } })) {
    await message("foto_porton", "guardia", "[DEMO] Así quedó el portón del galpón después de la tormenta.", "COMMAND", -3);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420"><rect width="640" height="420" fill="#3a3f47"/><rect x="60" y="80" width="520" height="300" fill="#8a929c" stroke="#1f2328" stroke-width="10"/><path d="M60 80 L580 380" stroke="#c62828" stroke-width="14"/><text x="320" y="60" font-family="Arial" font-size="30" fill="#fff" text-anchor="middle">[DEMO] Portón del galpón</text></svg>`;
    const bytes = await sharp(Buffer.from(svg)).jpeg({ quality: 78 }).toBuffer();
    await tx.chatAttachment.create({ data: { id: lf("chat_foto_porton_1"), messageId: lf("chat_foto_porton"), bytes: new Uint8Array(bytes), sha256: createHash("sha256").update(bytes).digest("hex") } });
  }
  await message("comision", "directiva", "[DEMO] Reunión de Comisión Directiva el jueves a las 20 h: balance del trimestre y compras del depósito.", "BOARD", -1);

  // ---------------------------------------------------------------------------
  // 6. Constancia de intervencion: datos del formulario en papel en las planillas ya cargadas.
  // ---------------------------------------------------------------------------
  const byType: Record<string, string[]> = { FIRE: ["INCENDIO_ESTRUCTURAL"], RESCUE: ["RESCATE_PERSONA"], ACCIDENT: ["ACCIDENTE_VEHICULAR"], CHEMICAL: ["PERDIDA_GAS"], MEDICAL: ["COOPERACIONES_VARIAS"], FLOOD: ["INUNDACION"], OTHER: ["OTROS"] };
  const sheets = await tx.incidentSheet.findMany({ where: { addressNumber: "", incidentId: { startsWith: "demo_v2_" } }, include: { incident: { select: { type: true, alert: { select: { createdBy: { select: { username: true, profile: { select: { fullName: true } } } } } } } } } });
  for (const [index, sheet] of sheets.entries()) {
    const classes = byType[sheet.incident.type] ?? ["OTROS"];
    await tx.incidentSheet.update({ where: { incidentId: sheet.incidentId }, data: {
      addressNumber: ["1062", "450", "km 612", "1250", "88"][index % 5]!, receivedBy: sheet.incident.alert?.createdBy.profile?.fullName || sheet.incident.alert?.createdBy.username || "[DEMO] Guardia de turno",
      classifications: classes, classificationDetail: classes.includes("OTROS") ? "Garrafa" : "", firefightersOnScene: index === 0 ? "[DEMO] Bomberos Voluntarios de Río Cuarto, móvil 12" : "",
    } });
  }
  // ---------------------------------------------------------------------------
  // 7. Novedades del movil en salida: combustible, fluidos del ultimo control, ERA con poca carga y una falla.
  // ---------------------------------------------------------------------------
  await tx.vehicle.updateMany({ where: { id: { startsWith: id("vehicle_") }, fuelType: null }, data: { fuelType: "Gasoil Súper" } });
  const fluidsByVehicle: Record<number, { oilLevel: string; coolantLevel: string; fuelLevel: string }> = {
    0: { oilLevel: "LOW", coolantLevel: "OK", fuelLevel: "QUARTER" }, 1: { oilLevel: "OK", coolantLevel: "OK", fuelLevel: "FULL" }, 2: { oilLevel: "OK", coolantLevel: "ADDED", fuelLevel: "THREE_QUARTERS" },
    3: { oilLevel: "OK", coolantLevel: "OK", fuelLevel: "HALF" }, 4: { oilLevel: "OK", coolantLevel: "OK", fuelLevel: "FULL" }, 5: { oilLevel: "OK", coolantLevel: "OK", fuelLevel: "RESERVE" },
  };
  for (const [index, fluids] of Object.entries(fluidsByVehicle)) {
    const last = await tx.inspection.findFirst({ where: { vehicleId: id(`vehicle_${index}`), voidedAt: null }, orderBy: [{ inspectionDate: "desc" }, { createdAt: "desc" }], select: { id: true, fuelLevel: true } });
    if (last && !last.fuelLevel) await tx.inspection.update({ where: { id: last.id }, data: fluids });
  }
  await tx.asset.upsert({ where: { id: lf("era_low_asset") }, update: {}, create: { id: lf("era_low_asset"), name: "[DEMO] Cilindro ERA 6.8L de reserva", assetType: "PPE", status: "OPERATIONAL" } });
  await tx.airCylinder.upsert({ where: { id: lf("era_low") }, update: {}, create: { id: lf("era_low"), assetId: lf("era_low_asset"), code: "ERA-300-R", serialNumber: "SN-DEMO-RESERVA-01", ratedPressureBar: 300, pressureBar: 110, vehicleAssetId: id("asset_0"), reviewedAt: day(-3), lastEventAt: day(-3), createdAt: day(-90) } });
  await tx.airHydroTest.upsert({ where: { id: lf("era_low_hydro") }, update: {}, create: { id: lf("era_low_hydro"), cylinderId: lf("era_low"), result: "PASS", testedOn: day(-200), validUntil: day(900), certificateReference: "PH-DEMO-RESERVA-01", notes: "[DEMO] Prueba hidráulica aprobada", registeredByUserId: id("admin") } });
  await tx.maintenanceJob.upsert({ where: { id: lf("maintenance_brakes") }, update: {}, create: {
    id: lf("maintenance_brakes"), assetId: id("asset_0"), title: "Posible falla en los frenos", description: "[DEMO] Pedal largo al frenar en bajada. Revisar pastillas y nivel de líquido de frenos.",
    status: "OPEN", blocksOperation: false, createdByUserId: id("guardia"), createdAt: at(-1, 18),
  } });

  return { guardAccounts: 2, supplyItems: items.length, materialRequests: requests.length, polls: 2, sheetsCompleted: sheets.length };
}
