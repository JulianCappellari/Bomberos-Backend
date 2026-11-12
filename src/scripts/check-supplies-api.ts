import { enableAutoStepUp } from "./step-up-test-helper";
import "dotenv/config";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";
import sharp from "sharp";

// Deposito (vestimenta y materiales), pedidos de materiales, fotos y links en Comunicaciones,
// apartado de la Comision Directiva y alertas sin convocar a guardia ni administracion.
async function main() {
  if (process.env.NODE_ENV === "production") throw Error("No se prueba en producción");
  const original = process.env.DATABASE_URL!, schema = "supplies_verify_" + randomBytes(8).toString("hex"), url = new URL(original);
  url.searchParams.set("schema", schema);
  const root = new PrismaClient({ datasourceUrl: original });
  let db: PrismaClient | undefined, server: import("node:http").Server | undefined;
  try {
    execFileSync(process.execPath, [require.resolve("prisma/build/index.js"), "migrate", "deploy"], { env: { ...process.env, DATABASE_URL: url.toString() }, stdio: "pipe" });
    process.env.DATABASE_URL = url.toString();
    const { prisma } = await import("../config/prisma"); db = prisma;
    const { app } = await import("../app");
    server = app.listen(0, "127.0.0.1"); await new Promise<void>((r) => server!.once("listening", r));
    const address = server.address(); assert(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}/api`;
    let paths = 0;
    async function call(path: string, status: number, token?: string, method = "GET", body?: unknown) {
      const response = await fetch(base + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
      const type = response.headers.get("content-type") || "";
      const data = type.includes("json") ? await response.json() : await response.arrayBuffer();
      assert.equal(response.status, status, `${method} ${path}: ${type.includes("json") ? JSON.stringify(data) : type}`); paths++; return data;
    }
    const password = randomUUID() + "!Aa7", passwordHash = await bcrypt.hash(password, 10);
    enableAutoStepUp(() => password);
    const people: Array<[string, string, string[]]> = [["Administrador", "ADMIN", []], ["Oficial", "FIREFIGHTER", []], ["Sub oficial", "FIREFIGHTER", []], ["Bombero", "FIREFIGHTER", []], ["Bombero", "FIREFIGHTER", ["PPE"]], ["Guardia", "FIREFIGHTER", []], ["Comision directiva", "FIREFIGHTER", []]];
    const users: Array<{ id: string }> = [], tokens: string[] = [];
    for (const [i, [rank, role, specialPermissions]] of people.entries()) {
      const user = await prisma.user.create({ data: { username: "supplies_test_" + i, role: role as "ADMIN", passwordHash, specialPermissions, emergencyStatusConfirmedAt: new Date(), profile: { create: { rank, fullName: "Prueba depósito " + i, dni: "SU-" + i, badge: "SU-" + i } } } });
      users.push(user); tokens.push((await call("/auth/login", 200, undefined, "POST", { username: user.username, password })).tokens.accessToken);
    }
    const [admin, officer, sub, bombero, keeper, guard, board] = tokens;
    const [, , , bomberoUser, keeperUser, guardUser, boardUser] = users;
    const truck = await prisma.asset.create({ data: { name: "Autobomba", assetType: "VEHICLE", vehicle: { create: { unitNumber: "8" } } }, include: { vehicle: true } });

    // --- Deposito: solo el encargado (permiso PPE) o administracion ---
    await call("/supplies/items", 403, bombero);
    await call("/supplies/items", 403, sub); // sub oficial sin permiso de encargado no maneja el stock
    await call("/supplies/items", 200, officer); // jefatura (oficial) puede consultarlo
    const shirt = await call("/supplies/items", 201, keeper, "POST", { name: "Remera institucional", category: "VESTIMENTA", size: "M", minQuantity: 3, initialQuantity: 5 });
    assert.equal(shirt.quantity, 5);
    await call("/supplies/items", 400, keeper, "POST", { name: "Casco", category: "SOMBRERO" });
    await call(`/supplies/items/${shirt.id}/movements`, 201, keeper, "POST", { type: "IN", quantity: 10, reason: "Compra de remeras" });
    await call(`/supplies/items/${shirt.id}/movements`, 400, keeper, "POST", { type: "ASSIGN", quantity: 1, reason: "Entrega sin destino" });
    await call(`/supplies/items/${shirt.id}/movements`, 201, keeper, "POST", { type: "ASSIGN", quantity: 2, reason: "Entrega personal", assignedUserId: bomberoUser!.id });
    await call(`/supplies/items/${shirt.id}/movements`, 201, keeper, "POST", { type: "LOSS", quantity: 1, reason: "Faltante en el recuento" });
    await call(`/supplies/items/${shirt.id}/movements`, 409, keeper, "POST", { type: "OUT", quantity: 50, reason: "Más de lo que hay" });
    await call(`/supplies/items/${shirt.id}/movements`, 201, keeper, "POST", { type: "OUT", quantity: 9, reason: "Baja por desgaste" });
    let items = await call("/supplies/items", 200, keeper);
    assert.equal(items[0].quantity, 3); assert.equal(items[0].lowStock, true, "Al llegar al mínimo queda marcado como faltante");
    await call(`/supplies/items/${shirt.id}/movements`, 201, keeper, "POST", { type: "ADJUST", quantity: 4, reason: "Recuento mensual" });
    const movements = await call(`/supplies/movements?itemId=${shirt.id}`, 200, keeper);
    assert.deepEqual(movements.map((m: { type: string }) => m.type).reverse(), ["IN", "IN", "ASSIGN", "LOSS", "OUT", "ADJUST"]);
    assert.equal(movements.find((m: { type: string }) => m.type === "ASSIGN").assignedTo, "Prueba depósito 3");
    const updated = await call(`/supplies/items/${shirt.id}`, 200, keeper, "PUT", { name: "Remera institucional", category: "VESTIMENTA", size: "M", unit: "unidad", minQuantity: 5, location: "Placard 2", revision: (await prisma.supplyItem.findUniqueOrThrow({ where: { id: shirt.id } })).revision });
    assert.equal(updated.location, "Placard 2");
    await call(`/supplies/items/${shirt.id}`, 409, keeper, "PUT", { name: "Remera", category: "VESTIMENTA", unit: "unidad", minQuantity: 1, revision: 1 });
    const bulbs = await call("/supplies/items", 201, admin, "POST", { name: "Foco halógeno H4", category: "MOVIL", minQuantity: 1, initialQuantity: 2 });
    for (const action of ["SUPPLY_ITEM_CREATED", "SUPPLY_IN", "SUPPLY_ASSIGN", "SUPPLY_LOSS", "SUPPLY_OUT", "SUPPLY_ADJUST", "SUPPLY_ITEM_UPDATED"]) assert(await prisma.auditLog.findFirst({ where: { action } }), action);

    // --- Pedidos de materiales: oficial, sub oficial, administracion o guardia ---
    const order = { title: "Foco para el camión 8", destination: "VEHICLE", vehicleId: truck.vehicle!.id, quantity: 1, priority: "URGENT" };
    await call("/supplies/requests", 403, bombero, "POST", order);
    await call("/supplies/requests", 400, sub, "POST", { ...order, vehicleId: null });
    const req1 = await call("/supplies/requests", 201, sub, "POST", order);
    assert(await prisma.memberNotification.findFirst({ where: { userId: keeperUser!.id, title: { contains: "Foco para el camión 8" } } }), "Se avisa al encargado");
    const req2 = await call("/supplies/requests", 201, guard, "POST", { title: "Lavandina para el cuartel", destination: "STATION", quantity: 4 });
    await call("/supplies/requests", 201, officer, "POST", { title: "Cinta de peligro", destination: "STATION" });
    assert.equal((await call("/supplies/requests", 200, sub)).length, 1, "Quien pide ve solo sus pedidos");
    assert.equal((await call("/supplies/requests", 200, keeper)).length, 3, "El encargado ve todos");
    await call(`/supplies/requests/${req1.id}/decide`, 403, sub, "POST", { status: "APPROVED", revision: 1 });
    await call(`/supplies/requests/${req1.id}/decide`, 400, keeper, "POST", { status: "REJECTED", revision: 1 });
    await call(`/supplies/requests/${req1.id}/decide`, 200, keeper, "POST", { status: "APPROVED", revision: 1, notes: "Hay en depósito" });
    await call(`/supplies/requests/${req1.id}/decide`, 409, keeper, "POST", { status: "ORDERED", revision: 1 });
    const delivered = await call(`/supplies/requests/${req1.id}/decide`, 200, keeper, "POST", { status: "DELIVERED", revision: 2, supplyItemId: bulbs.id });
    assert.equal(delivered.status, "DELIVERED");
    assert.equal((await prisma.supplyItem.findUniqueOrThrow({ where: { id: bulbs.id } })).quantity, 1, "La entrega descuenta del depósito");
    assert.equal((await prisma.supplyMovement.findFirstOrThrow({ where: { requestId: req1.id } })).vehicleId, truck.vehicle!.id);
    assert(await prisma.memberNotification.findFirst({ where: { userId: users[2]!.id, title: { contains: "fue entregado" } } }), "Se avisa a quien pidió");
    await call(`/supplies/requests/${req1.id}/decide`, 409, keeper, "POST", { status: "REJECTED", revision: 3, notes: "Ya estaba entregado" });
    await call(`/supplies/requests/${req2.id}/cancel`, 404, officer, "POST");
    await call(`/supplies/requests/${req2.id}/cancel`, 200, guard, "POST");
    const summary = await call("/supplies/summary", 200, keeper);
    assert.equal(summary.openMaterialRequests, 1); assert.equal(summary.items, 2);
    await call("/supplies/summary", 403, bombero);
    const options = await call("/supplies/options", 200, guard);
    assert.equal(options.canRequest, true); assert.equal(options.manager, false); assert.equal(options.people.length, 0);
    await call(`/supplies/items/${bulbs.id}/archive`, 200, keeper, "POST", { reason: "Ya no se usa este modelo" });
    await call(`/supplies/items/${bulbs.id}/movements`, 404, keeper, "POST", { type: "IN", quantity: 1, reason: "Dado de baja" });

    // --- Comunicaciones con fotos y links ---
    const png = (await sharp({ create: { width: 60, height: 40, channels: 3, background: { r: 200, g: 30, b: 30 } } }).png().toBuffer()).toString("base64");
    const withPhoto = await call("/chat/messages", 201, bombero, "POST", { body: "", photos: [png], links: ["https://bomberos.example.org/protocolo"] });
    assert.equal(withPhoto.attachments.length, 1); assert.deepEqual(withPhoto.links, ["https://bomberos.example.org/protocolo"]);
    const image = await call(`/chat/messages/${withPhoto.id}/photos/${withPhoto.attachments[0].id}`, 200, officer);
    assert(new Uint8Array(image as ArrayBuffer)[0] === 0xff, "Se sirve como JPEG recomprimido");
    await call("/chat/messages", 400, bombero, "POST", { body: "" });
    await call("/chat/messages", 400, bombero, "POST", { body: "Mirá", links: ["javascript:alert(1)"] });
    await call("/chat/messages", 400, bombero, "POST", { body: "Mirá", photos: [Buffer.from("no es una imagen").toString("base64")] });
    await call("/chat/messages", 400, bombero, "POST", { body: "x", photos: [png, png, png, png] });
    const commandOnly = await call("/chat/messages", 201, officer, "POST", { body: "Plano", audience: "COMMAND", photos: [png] });
    await call(`/chat/messages/${commandOnly.id}/photos/${commandOnly.attachments[0].id}`, 403, bombero);

    // --- Comision Directiva: finanzas y transparencia (solo lectura) ---
    await call("/commission/overview", 403, bombero);
    await call("/commission/overview", 403, guard);
    assert.equal((await call("/commission/access", 200, board)).allowed, true);
    const claim = await prisma.expenseClaim.create({ data: { operationKey: randomUUID(), userId: bomberoUser!.id, title: "Compra de mangueras", notes: "Proveedor local", occurredOn: new Date(), amountCents: 150000, status: "APPROVED" } });
    await prisma.expensePayment.create({ data: { operationKey: randomUUID(), claimId: claim.id, amountCents: 100000, reference: "Transferencia 001" } });
    const overview = await call("/commission/overview?months=6", 200, board);
    assert.equal(overview.totals.expensesApprovedCents, 150000); assert.equal(overview.totals.expensesPaidCents, 100000); assert.equal(overview.totals.expensesDebtCents, 50000);
    assert.equal(overview.series.length, 6); assert.equal(overview.expenses[0].requestedBy, "Prueba depósito 3");
    assert.equal(overview.station.openMaterialRequests, 1);
    await call("/commission/overview", 200, admin);
    await call("/commission/overview?months=99", 400, board);

    // --- Alertas: la guardia y la administracion no tienen que confirmar ---
    const alert = await call("/alerts", 201, officer, "POST", { type: "FIRE", priority: "HIGH", location: "Ruta 8 km 600", description: "Incendio de pastizal de prueba" });
    assert(await prisma.memberNotification.findFirst({ where: { dedupeKey: `alert:${alert.id}:${bomberoUser!.id}` } }), "El bombero disponible es convocado");
    assert(!(await prisma.memberNotification.findFirst({ where: { dedupeKey: `alert:${alert.id}:${guardUser!.id}` } })), "La guardia no es convocada");
    assert(await prisma.memberNotification.findFirst({ where: { dedupeKey: `alert-guard:${alert.id}:${guardUser!.id}` } }), "La guardia recibe el aviso informativo");
    assert(!(await prisma.memberNotification.findFirst({ where: { dedupeKey: `alert:${alert.id}:${users[0]!.id}` } })), "La cuenta de administración no es convocada");
    await call(`/alerts/${alert.id}/respond`, 403, guard, "POST", { response: "GOING" });
    await call(`/alerts/${alert.id}/respond`, 200, bombero, "POST", { response: "GOING" });
    assert(!(await prisma.memberNotification.findFirst({ where: { userId: boardUser!.id, dedupeKey: { startsWith: `alert` } } })), "La Comisión Directiva (civil) no es convocada");

    // --- ¿Me llegan las alertas al celular? Motivo visible y arreglo en un toque ---
    assert.equal((await call("/push/alert-readiness", 200, bombero)).status, "YES");
    assert.equal((await call("/push/alert-readiness", 200, guard)).status, "INFO");
    assert.equal((await call("/push/alert-readiness", 200, board)).status, "NONE");
    await prisma.user.update({ where: { id: keeperUser!.id }, data: { emergencyStatusConfirmedAt: null } });
    const notReady = await call("/push/alert-readiness", 200, keeper);
    assert.equal(notReady.status, "NONE"); assert.equal(notReady.canFix, true);
    await call("/members/availability/available-now", 200, keeper, "POST");
    assert.equal((await call("/push/alert-readiness", 200, keeper)).status, "YES");
    assert(await prisma.memberNotification.findFirst({ where: { userId: keeperUser!.id, dedupeKey: `alert:${alert.id}:${keeperUser!.id}` } }), "Al marcarse disponible recibe la alerta activa");

    // --- La alerta deja de pedir confirmación al cerrarse la planilla de su intervención ---
    const linked = await call(`/incidents/from-alert/${alert.id}`, 201, officer, "POST", {});
    await call(`/incidents/${linked.id}/close`, 200, officer, "PATCH", { closingReport: "Incendio controlado, sin novedades." });
    assert.equal((await prisma.alert.findUniqueOrThrow({ where: { id: alert.id } })).status, "RESOLVED", "Cerrar la planilla desactiva la alerta");
    await call(`/alerts/${alert.id}/respond`, 409, keeper, "POST", { response: "GOING" });

    // --- Constancia de intervención: pedido de auxilio N° y datos del papel ---
    const year = Number(new Intl.DateTimeFormat("en", { year: "numeric", timeZone: "America/Argentina/Buenos_Aires" }).format(new Date()));
    const first = await prisma.incident.create({ data: { title: "Pérdida de gas", type: "OTHER", description: "Garrafa", location: "Belgrano", createdByUserId: users[1]!.id } });
    const second = await prisma.incident.create({ data: { title: "Incendio", type: "FIRE", description: "Vivienda", location: "San Martín", createdByUserId: users[1]!.id } });
    assert.equal(first.requestYear, year); assert.equal(second.requestNumber, first.requestNumber! + 1, "Numeración correlativa por año");
    const sheetBody = { revision: 0, callerName: "Castro Nora", callerPhone: "358 4000000", addressNumber: "1062", receivedBy: "Lagunas F.", firefightersOnScene: "Bomberos de Río Cuarto, móvil 12", classifications: ["INCENDIO_ESTRUCTURAL", "OTROS"], classificationDetail: "Garrafa", notes: "Se controló la pérdida de la garrafa y se ventiló el lugar.", baseUserIds: [], materials: [{ name: "Matafuego PQS", quantity: 1, notes: "" }], evidenceUrls: [] };
    await call(`/incidents/${first.id}/sheet`, 400, officer, "PUT", { ...sheetBody, classifications: ["TERREMOTO"] });
    await call(`/incidents/${first.id}/sheet`, 200, officer, "PUT", sheetBody);
    const savedSheet = await call(`/incidents/${first.id}/sheet`, 200, officer);
    assert.equal(savedSheet.sheet.addressNumber, "1062"); assert.deepEqual(savedSheet.sheet.classifications, ["INCENDIO_ESTRUCTURAL", "OTROS"]); assert.equal(savedSheet.sheet.receivedBy, "Lagunas F.");
    assert.equal(savedSheet.context.incident.requestNumber, first.requestNumber);
    await call(`/incidents/${first.id}/sheet/request-number`, 403, bombero, "PATCH", { requestNumber: 60, requestYear: year, reason: "Empalmar con el libro" });
    await call(`/incidents/${first.id}/sheet/request-number`, 200, officer, "PATCH", { requestNumber: 60, requestYear: year, reason: "Empalmar con el libro" });
    await call(`/incidents/${second.id}/sheet/request-number`, 409, officer, "PATCH", { requestNumber: 60, requestYear: year, reason: "Número repetido" });
    const third = await prisma.incident.create({ data: { title: "Rescate de animal", type: "RESCUE", description: "Gato", location: "Centro", createdByUserId: users[1]!.id } });
    assert.equal(third.requestNumber, 61, "Sigue después del número corregido");
    assert(await prisma.auditLog.findFirst({ where: { action: "INCIDENT_REQUEST_NUMBER_CHANGED" } }));

    // --- Licencias por clase: el móvil exige su categoría y la licencia vigente habilita sola ---
    const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
    const licenseBase = { category: "DRIVER_LICENSE", title: "Licencia de conducir", details: "Declaración del titular", license: { number: "LIC-123", issuer: "Municipalidad de Sampacho", issuedOn: day(-400), expiresOn: day(800) } };
    await call("/members/declarations", 400, bombero, "POST", { ...licenseBase, license: { ...licenseBase.license, classes: ["Z9"] } });
    const onlyB = await call("/members/declarations", 201, bombero, "POST", { ...licenseBase, license: { ...licenseBase.license, classes: ["b1"] } });
    assert.deepEqual(onlyB.licenseClasses, ["B.1"], "Se normaliza al formato oficial");
    const engine = await prisma.asset.create({ data: { name: "Autobomba mediana", assetType: "VEHICLE", status: "OPERATIONAL", lastCheckDate: new Date(), vehicle: { create: { unitNumber: "5", licenseCategory: "MEDIUM" } } } });
    const dispatch = { incidentId: second.id, assetId: engine.id, driverUserId: bomberoUser!.id, leaderUserId: bomberoUser!.id, userIds: [bomberoUser!.id] };
    const denied = await call("/incidents/logistics", 403, officer, "POST", dispatch);
    assert.match(denied.message, /C\.1 y D\.4/, "Dice qué clases faltan");
    await call(`/members/declarations/${onlyB.id}`, 200, bombero, "PUT", { ...licenseBase, revision: onlyB.revision, license: { ...licenseBase.license, classes: [{ code: "C.1", grantedOn: day(-300) }, { code: "D.4", grantedOn: day(-300), expiresOn: day(-3) }] } });
    const expiredD4 = await call("/incidents/logistics", 403, officer, "POST", dispatch);
    assert.match(expiredD4.message, /D\.4/, "Una clase vencida no habilita aunque la licencia siga vigente");
    const current = await prisma.personalDeclaration.findUniqueOrThrow({ where: { id: onlyB.id } });
    await call(`/members/declarations/${onlyB.id}`, 200, bombero, "PUT", { ...licenseBase, revision: current.revision, license: { ...licenseBase.license, classes: [{ code: "C.2", grantedOn: day(-300) }, { code: "D.4", grantedOn: day(-300) }] } });
    assert((await call("/incidents/logistics/options", 200, officer)).licensed.some((r: { assetId: string; userId: string }) => r.assetId === engine.id && r.userId === bomberoUser!.id), "C.2 incluye C.1: queda habilitado para el móvil");
    const departed = await call("/incidents/logistics", 201, officer, "POST", dispatch);
    assert.equal((await prisma.auditLog.findFirstOrThrow({ where: { entityId: departed.id, action: "MISSION_DEPARTED" } }).then((r) => (r.metadata as { driverProof: { via: string } }).driverProof.via)), "LICENSE");
    // --- Horarios manuales: la planilla se carga a veces después de la salida o de la llegada ---
    const ago = (minutes: number) => new Date(Date.now() - minutes * 60000).toISOString();
    const departedRow = await prisma.missionMovement.findUniqueOrThrow({ where: { id: departed.id } });
    await call(`/incidents/logistics/${departed.id}/arrive`, 400, officer, "POST", { at: new Date(departedRow.departedAt.getTime() - 5 * 60000).toISOString() });
    await call(`/incidents/logistics/${departed.id}/arrive`, 400, officer, "POST", { at: new Date(Date.now() + 10 * 60000).toISOString() });
    await call(`/incidents/logistics/${departed.id}/arrive`, 200, officer, "POST", { at: new Date().toISOString() });
    await call(`/incidents/logistics/${departed.id}/return`, 200, officer, "POST", {});
    await call(`/incidents/logistics/${departed.id}/times`, 400, officer, "PATCH", { departedAt: ago(40) });
    await call(`/incidents/logistics/${departed.id}/times`, 400, officer, "PATCH", { departedAt: ago(20), arrivedAt: ago(30), reason: "Llegada antes de la salida" });
    await call(`/incidents/logistics/${departed.id}/times`, 200, officer, "PATCH", { departedAt: ago(40), arrivedAt: ago(30), reason: "La planilla se cargó después de la salida" });
    const corrected = await prisma.missionMovement.findUniqueOrThrow({ where: { id: departed.id } });
    assert(Math.abs(+corrected.departedAt - (Date.now() - 40 * 60000)) < 5000, "Se guarda la hora real de salida");
    assert.equal(+(await prisma.vehicleDeparture.findUniqueOrThrow({ where: { id: corrected.departureId! } })).departedAt, +corrected.departedAt, "El registro de salidas del móvil queda igual");
    assert(await prisma.auditLog.findFirst({ where: { entityId: departed.id, action: "MISSION_TIMES_CORRECTED" } }));
    const lateBody = { incidentId: third.id, assetId: engine.id, driverUserId: bomberoUser!.id, leaderUserId: bomberoUser!.id, userIds: [bomberoUser!.id] };
    await call("/incidents/logistics", 409, officer, "POST", { ...lateBody, departedAt: ago(35), returnedAt: ago(10) }); // se superpone con la salida corregida
    await call("/incidents/logistics", 400, officer, "POST", { ...lateBody, departedAt: ago(130), returnedAt: ago(120) }); // mas de 1 h antes del aviso
    await call("/incidents/logistics", 400, officer, "POST", { ...lateBody, departedAt: ago(50), returnedAt: ago(55) }); // regreso antes de la salida
    const late = await call("/incidents/logistics", 201, officer, "POST", { ...lateBody, departedAt: ago(58), arrivedAt: ago(52), returnedAt: ago(45) });
    const lateRow = await prisma.missionMovement.findUniqueOrThrow({ where: { id: late.id } });
    assert(lateRow.returnedAt && lateRow.departureId, "Salida completa cargada después del regreso");
    assert(await prisma.auditLog.findFirst({ where: { entityId: late.id, action: "MISSION_LOADED_LATE" } }));

    // --- Inicio: fallas del móvil para quien salió, hasta que vuelva al cuartel ---
    await prisma.maintenanceJob.create({ data: { assetId: engine.id, title: "Sirena con falso contacto", description: "Funciona de a ratos; usar bocina", blocksOperation: false, createdByUserId: users[1]!.id } });
    await prisma.complianceRecord.create({ data: { subjectType: "ASSET", assetId: engine.id, category: "VTV", title: "VTV 2026", expiresAt: new Date(Date.now() - 2 * 86_400_000), createdByUserId: users[1]!.id } });
    assert.equal((await call("/incidents/logistics/briefing", 200, bombero)).length, 0, "Sin salida activa no muestra nada");
    const live = await call("/incidents/logistics", 201, officer, "POST", { ...lateBody, dispatchExceptionReason: "Sale con la sirena fallando: se usa bocina" });
    const briefing = await call("/incidents/logistics/briefing", 200, bombero);
    assert.equal(briefing.length, 1); assert.equal(briefing[0].vehicle, "5"); assert.equal(briefing[0].role, "Conductor");
    assert.equal(briefing[0].notes[0].level, "critical", "Lo vencido va primero"); assert.match(briefing[0].notes[0].text, /VTV vencido/);
    assert(briefing[0].notes.some((n: { text: string }) => n.text === "Sirena con falso contacto"));
    assert(briefing[0].notes.some((n: { text: string; detail?: string }) => n.text === "Salió de forma excepcional" && n.detail?.includes("bocina")));
    assert.equal((await call("/incidents/logistics/briefing", 200, keeper)).length, 0, "Quien no salió no ve el aviso");
    // --- Corregir la dotación: agregar y quitar personas; el conductor debe estar habilitado ---
    await call(`/incidents/logistics/${live.id}/crew`, 403, officer, "PATCH", { userIds: [bomberoUser!.id, keeperUser!.id], driverUserId: keeperUser!.id, leaderUserId: bomberoUser!.id, reason: "Cambio de conductor" });
    await call(`/incidents/logistics/${live.id}/crew`, 400, officer, "PATCH", { userIds: [bomberoUser!.id], driverUserId: bomberoUser!.id, leaderUserId: bomberoUser!.id });
    await call(`/incidents/logistics/${live.id}/crew`, 200, officer, "PATCH", { userIds: [bomberoUser!.id, keeperUser!.id], driverUserId: bomberoUser!.id, leaderUserId: keeperUser!.id, reason: "Faltaba cargar a una integrante" });
    assert.equal((await call("/incidents/logistics/briefing", 200, keeper)).length, 1, "Al agregarla ve el aviso del móvil");
    await call(`/incidents/logistics/${live.id}/crew`, 200, officer, "PATCH", { userIds: [bomberoUser!.id], driverUserId: bomberoUser!.id, leaderUserId: bomberoUser!.id, reason: "No había salido, quedó en el cuartel" });
    assert.equal(await prisma.missionCrew.count({ where: { movementId: live.id } }), 1);
    assert(await prisma.auditLog.findFirst({ where: { entityId: live.id, action: "MISSION_CREW_CORRECTED" } }));
    await call(`/incidents/logistics/${live.id}/arrive`, 200, officer, "POST", {});
    await call(`/incidents/logistics/${live.id}/return`, 200, officer, "POST", {});
    assert.equal((await call("/incidents/logistics/briefing", 200, bombero)).length, 0, "Desaparece cuando el móvil vuelve");
    // Personal actuante no se ofrece como personal en base.
    const thirdSheet = await call(`/incidents/${third.id}/sheet`, 200, officer);
    assert(!thirdSheet.context.baseCandidates.some((p: { id: string }) => p.id === bomberoUser!.id), "Quien salió no figura para la base");

    // --- Cerrar la permanencia sin QR: nunca acredita más que la última presencia verificada (+30 min) ---
    const central = await prisma.station.create({ data: { name: "Cuartel con ubicación", latitude: -33.1, longitude: -64.7, radiusMeters: 80 } });
    const minutesAgo = (m: number) => new Date(Date.now() - m * 60000);
    const openStay = (checkIn: number, verified: number | null) => prisma.attendance.create({ data: { userId: keeperUser!.id, stationId: central.id, status: "OPEN", checkInAt: minutesAgo(checkIn), checkInTrust: "HIGH", lastPresenceConfirmedAt: verified === null ? null : minutesAgo(verified) } });
    const stay1 = await openStay(180, 120);
    const preview = await call("/attendance/me/close-remote", 200, keeper);
    assert.equal(preview.open, true); assert(Math.abs(+new Date(preview.creditedUntil) - +minutesAgo(90)) < 5000, "Tope: última verificación + 30 min");
    await call("/attendance/me/close-remote", 400, keeper, "POST", { leftAt: new Date(Date.now() + 3600000).toISOString() });
    await call("/attendance/me/close-remote", 400, keeper, "POST", { leftAt: minutesAgo(240).toISOString() });
    await call("/attendance/me/close-remote", 403, guard, "POST", {});
    const remote1 = await call("/attendance/me/close-remote", 200, keeper, "POST", { reason: "Me fui sin escanear" });
    assert.equal(remote1.capped, true); assert.equal(remote1.method, "REMOTE"); assert(Math.abs(remote1.workedMinutes - 90) <= 1, "Acredita 1 h 30, no las 3 h");
    assert.equal((await prisma.attendance.findUniqueOrThrow({ where: { id: stay1.id } })).checkOutMethod, "REMOTE");
    await openStay(60, null);
    const remote2 = await call("/attendance/me/close-remote", 200, keeper, "POST", { latitude: -33.1001, longitude: -64.7001, accuracy: 10 });
    assert.equal(remote2.gpsInside, true); assert.equal(remote2.method, "REMOTE_GPS"); assert(remote2.workedMinutes >= 59, "Con GPS en el cuartel cierra en el momento");
    await openStay(120, 10);
    const remote3 = await call("/attendance/me/close-remote", 200, keeper, "POST", { leftAt: minutesAgo(60).toISOString(), latitude: -32.5, longitude: -64.1, accuracy: 15 });
    assert.equal(remote3.gpsInside, false); assert.equal(remote3.capped, false); assert(Math.abs(remote3.workedMinutes - 60) <= 1, "Respeta la hora declarada si es anterior al tope");
    assert(await prisma.memberNotification.findFirst({ where: { dedupeKey: { startsWith: `remote-close:${keeperUser!.id}:` } } }), "Al 3.er cierre sin QR del mes se avisa a jefatura");
    const missionStay = await openStay(30, 5);
    const onMission = await prisma.missionMovement.create({ data: { incidentId: third.id, assetId: engine.id, driverUserId: keeperUser!.id, leaderUserId: keeperUser!.id, createdByUserId: users[1]!.id, crew: { create: [{ userId: keeperUser!.id }] } } });
    await call("/attendance/me/close-remote", 409, keeper, "POST", {});
    await prisma.missionMovement.update({ where: { id: onMission.id }, data: { returnedAt: new Date(), returnWithoutArrivalReason: "Falsa salida de prueba" } });
    await call("/attendance/me/close-remote", 200, keeper, "POST", {});
    assert.equal((await prisma.attendance.findUniqueOrThrow({ where: { id: missionStay.id } })).status, "CLOSED");
    const monthly = await call(`/operations/reports/monthly?month=${new Date().toISOString().slice(0, 7)}`, 200, officer);
    assert((monthly.totals.remoteCloses ?? 0) >= 4, "El reporte muestra los cierres sin QR");

    // La guardia de turno edita la planilla sin fichar con QR.
    assert.equal((await call(`/incidents/${second.id}/sheet`, 200, guard)).canWrite, true);

    // --- Comisión Directiva: cuenta civil, no opera como bombero ---
    const openQr = await call("/attendance/qr-challenges", 201, guard, "POST", { stationId: "base-sin-ubicacion" });
    await call("/attendance/scan", 403, board, "POST", { qrToken: openQr.qrToken, deviceFingerprint: "board-phone" });
    const roster = await call("/users/roster", 200, officer);
    assert(!roster.some((u: { id: string }) => u.id === boardUser!.id), "La Comisión no figura en las listas de dotación");

    console.log(`Depósito y comisión: ${paths} caminos HTTP aprobados; stock, faltantes, pedidos de materiales, fotos y links en comunicaciones, transparencia y alertas sin convocar a la guardia.`);
  } finally {
    server?.close(); await db?.$disconnect();
    await root.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => {});
    await root.$disconnect();
  }
}
main().catch((error) => { console.error(error); process.exit(1); });
