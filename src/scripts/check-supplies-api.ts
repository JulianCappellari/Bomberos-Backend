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

    // --- Licencias: una clase por formulario; el móvil exige su categoría y jefatura autoriza cada móvil ---
    const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
    const licenseBase = { category: "DRIVER_LICENSE", title: "Licencia de conducir", details: "Declaración del titular", license: { number: "LIC-123", issuer: "Municipalidad de Sampacho", issuedOn: day(-400), expiresOn: day(800) } };
    const licenseOf = (number: string, code: string, extra: Record<string, string> = {}) => ({ ...licenseBase, license: { ...licenseBase.license, number, classes: [{ code }], ...extra } });
    await call("/members/declarations", 400, bombero, "POST", { ...licenseBase, license: { ...licenseBase.license, classes: ["Z9"] } });
    await call("/members/declarations", 400, bombero, "POST", { ...licenseBase, license: { ...licenseBase.license, classes: ["B.1", "C.1"] } }); // un número, una clase
    const onlyB = await call("/members/declarations", 201, bombero, "POST", { ...licenseBase, license: { ...licenseBase.license, classes: ["b1"] } });
    assert.deepEqual(onlyB.licenseClasses, ["B.1"], "Se normaliza al formato oficial");
    await call("/members/declarations", 409, bombero, "POST", licenseOf("LIC-999", "B.1")); // la clase ya está cargada
    const engine = await prisma.asset.create({ data: { name: "Autobomba mediana", assetType: "VEHICLE", status: "OPERATIONAL", lastCheckDate: new Date(), vehicle: { create: { unitNumber: "5", licenseCategory: "MEDIUM" } } } });
    const dispatch = { incidentId: second.id, assetId: engine.id, driverUserId: bomberoUser!.id, leaderUserId: bomberoUser!.id, userIds: [bomberoUser!.id] };
    const denied = await call("/incidents/logistics", 403, officer, "POST", dispatch);
    assert.match(denied.message, /C\.1 y D\.4/, "Dice qué clases faltan");
    await call("/members/declarations", 201, bombero, "POST", licenseOf("LIC-C2", "C.2"));
    const d4 = await call("/members/declarations", 201, bombero, "POST", licenseOf("LIC-D4", "D.4", { issuedOn: day(-400), expiresOn: day(-3) }));
    const expiredD4 = await call("/incidents/logistics", 403, officer, "POST", dispatch);
    assert.match(expiredD4.message, /D\.4/, "Una licencia vencida no habilita");
    assert.equal(await prisma.vehicleDriverAuthorization.count({ where: { assetId: engine.id, userId: bomberoUser!.id } }), 0, "Sin cobertura no hay pedido");
    await call(`/members/declarations/${d4.id}`, 200, bombero, "PUT", { ...licenseOf("LIC-D4", "D.4"), revision: d4.revision });
    // C.2 incluye C.1: la licencia cubre el móvil y se genera el pedido para jefatura; todavía no puede manejar.
    const request = await prisma.vehicleDriverAuthorization.findUniqueOrThrow({ where: { assetId_userId: { assetId: engine.id, userId: bomberoUser!.id } } });
    assert.equal(request.status, "PENDING");
    assert(await prisma.memberNotification.findFirst({ where: { title: { contains: "Habilitación de conductor pendiente" } } }), "Se avisa a jefatura del pedido");
    const mine = await call("/members/driving", 200, bombero);
    const unit5 = mine.find((v: { unitNumber: string }) => v.unitNumber === "5");
    assert.equal(unit5.covered, true); assert.equal(unit5.authorization, "PENDING"); assert.equal(unit5.canDrive, false);
    await call(`/members/driving?userId=${users[1]!.id}`, 403, bombero);
    assert(!(await call("/incidents/logistics/options", 200, officer)).licensed.some((r: { assetId: string; userId: string }) => r.assetId === engine.id && r.userId === bomberoUser!.id), "Sin autorización no figura como conductor");
    const pendingDispatch = await call("/incidents/logistics", 403, officer, "POST", dispatch);
    assert.match(pendingDispatch.message, /pendiente de autorización/);
    await call("/incidents/logistics/drivers", 403, bombero);
    const queue = await call("/incidents/logistics/drivers", 200, officer);
    assert(queue.some((r: { assetId: string; userId: string; status: string; covered: boolean }) => r.assetId === engine.id && r.userId === bomberoUser!.id && r.status === "PENDING" && r.covered));
    await call("/incidents/logistics/authorizations/decide", 400, officer, "POST", { assetId: engine.id, userId: bomberoUser!.id, revision: request.revision, decision: "REJECT" }); // rechazo sin motivo
    await call("/incidents/logistics/authorizations/decide", 409, officer, "POST", { assetId: engine.id, userId: bomberoUser!.id, revision: request.revision + 5, decision: "APPROVE" });
    await call("/incidents/logistics/authorizations/decide", 200, officer, "POST", { assetId: engine.id, userId: bomberoUser!.id, revision: request.revision, decision: "APPROVE" });
    assert(await prisma.memberNotification.findFirst({ where: { userId: bomberoUser!.id, title: { contains: "Podés manejar el móvil 5" } } }), "Se avisa a la persona");
    assert((await call("/incidents/logistics/options", 200, officer)).licensed.some((r: { assetId: string; userId: string }) => r.assetId === engine.id && r.userId === bomberoUser!.id), "Autorizado: queda habilitado para el móvil");
    const departed = await call("/incidents/logistics", 201, officer, "POST", dispatch);
    assert.equal((await prisma.auditLog.findFirstOrThrow({ where: { entityId: departed.id, action: "MISSION_DEPARTED" } }).then((r) => (r.metadata as { driverProof: { via: string } }).driverProof.via)), "LICENSE+AUTHORIZATION");
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
    // Fluidos del control, faltantes con cantidad y ERA con poca carga.
    const engineVehicle = await prisma.vehicle.update({ where: { assetId: engine.id }, data: { fuelType: "Gasoil Súper", mileage: 120500, nextOilChangeMileage: 120000 } });
    const box = await prisma.vehicleCompartment.create({ data: { vehicleId: engineVehicle.id, name: "Baulera 1" } });
    const hose = await prisma.vehicleInventoryItem.create({ data: { compartmentId: box.id, name: "Manguera 1\"", expectedQuantity: 2 } });
    await prisma.inspection.create({ data: { vehicleId: engineVehicle.id, inspectionDate: new Date(), oilLevel: "LOW", coolantLevel: "ADDED", fuelLevel: "RESERVE", summaryMissing: 1,
      items: { create: [{ inventoryItemId: hose.id, expectedQuantity: 2, observedQuantity: 1, result: "MISSING", observations: "Una quedó en el último incendio" }] } } });
    await assert.rejects(prisma.$executeRawUnsafe(`UPDATE "Inspection" SET "fuelLevel" = 'EMPTY' WHERE "vehicleId" = '${engineVehicle.id}'`), "La base rechaza niveles inventados");
    const eraAsset = await prisma.asset.create({ data: { name: "Cilindro ERA prueba", assetType: "PPE", status: "OPERATIONAL" } });
    const era = await prisma.airCylinder.create({ data: { assetId: eraAsset.id, code: "ERA-T1", serialNumber: "SN-T1", ratedPressureBar: 300, pressureBar: 100, vehicleAssetId: engine.id } });
    await prisma.airHydroTest.create({ data: { cylinderId: era.id, result: "PASS", testedOn: new Date(Date.now() - 900 * 86_400_000), validUntil: new Date(Date.now() - 30 * 86_400_000), certificateReference: "PH-T1", notes: "prueba", registeredByUserId: users[0]!.id } });
    const { createInspectionSchema } = await import("../modules/inspections/inspections.schemas");
    const baseControl = { draftId: "d", vehicleId: "v", inspectionDate: "2026-11-12", inspectionTime: "10:00", leaderUserId: "u", responsibleUserIds: ["u"], items: [{ inventoryItemId: "i", observedQuantity: 1, result: "OK" }] };
    assert(createInspectionSchema.safeParse({ ...baseControl, fluids: { oil: "OK", coolant: "ADDED", fuel: "THREE_QUARTERS" } }).success, "El control acepta los fluidos");
    assert(!createInspectionSchema.safeParse({ ...baseControl, fluids: { oil: "OK", coolant: "OK", fuel: "EMPTY" } }).success, "Nivel de combustible inválido");
    const live = await call("/incidents/logistics", 201, officer, "POST", { ...lateBody, dispatchExceptionReason: "Sale con la sirena fallando: se usa bocina" });
    const briefing = await call("/incidents/logistics/briefing", 200, bombero);
    assert.equal(briefing.length, 1); assert.equal(briefing[0].vehicle, "5"); assert.equal(briefing[0].role, "Conductor");
    assert.equal(briefing[0].notes[0].level, "critical", "Lo vencido va primero"); assert(briefing[0].notes.some((n: { text: string; level: string }) => n.level === "critical" && /VTV vencido/.test(n.text)));
    assert(briefing[0].notes.some((n: { text: string }) => n.text === "Sirena con falso contacto"));
    assert(briefing[0].notes.some((n: { text: string; detail?: string }) => n.text === "Salió de forma excepcional" && n.detail?.includes("bocina")));
    const texts = briefing[0].notes.map((n: { text: string }) => n.text);
    for (const expected of ["Combustible en reserva", "Aceite de motor bajo", "Tubo autónomo ERA-T1 descargado (100 de 300 bar)", "Tubo autónomo ERA-T1: prueba hidráulica vencida", "Falta: Manguera 1\" (hay 1 de 2)", "Cambio de aceite vencido", "Líquido refrigerante: se completó en el último control"]) assert(texts.includes(expected), `El aviso detalla: ${expected} (vino: ${texts.join(" | ")})`);
    assert.equal(briefing[0].fuelType, "Gasoil Súper");
    assert(briefing[0].counts.critical >= 3, "Cuenta lo importante");
    const levels = briefing[0].notes.map((n: { level: string }) => n.level); assert.deepEqual(levels, [...levels].sort((x: string, y: string) => ["critical", "warning", "info"].indexOf(x) - ["critical", "warning", "info"].indexOf(y)), "Ordenado por gravedad");
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
    const stay1 = await openStay(180, 100);
    const preview = await call("/attendance/me/close-remote", 200, keeper);
    assert.equal(preview.open, true); assert(Math.abs(+new Date(preview.creditedUntil) - +minutesAgo(70)) < 5000, "Tope: última verificación + 30 min"); assert.equal(preview.late, false);
    await call("/attendance/me/close-remote", 400, keeper, "POST", { leftAt: new Date(Date.now() + 3600000).toISOString() });
    await call("/attendance/me/close-remote", 400, keeper, "POST", { leftAt: minutesAgo(240).toISOString() });
    await call("/attendance/me/close-remote", 403, guard, "POST", {});
    // La huella del iPhone (user agent completo en base64) supera los 200 caracteres.
    const remote1 = await call("/attendance/me/close-remote", 200, keeper, "POST", { reason: "Me fui sin escanear", deviceFingerprint: "x".repeat(400) });
    assert.equal(remote1.capped, true); assert.equal(remote1.method, "REMOTE"); assert(Math.abs(remote1.workedMinutes - 110) <= 1, "Acredita 1 h 50, no las 3 h");
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
    // Base sin ubicación: misma regla. Se confirma presencia tocando el aviso y nunca se acredita más de lo verificado.
    const noGps = await prisma.station.create({ data: { name: "Base sin ubicación prueba", latitude: 0, longitude: 0, radiusMeters: 100, requiresLocation: false } });
    const noGpsQr = await prisma.qrChallenge.create({ data: { stationId: noGps.id, tokenHash: randomUUID(), expiresAt: new Date(Date.now() + 60000) } });
    const tapStay = await prisma.attendance.create({ data: { userId: keeperUser!.id, stationId: noGps.id, checkInQrId: noGpsQr.id, status: "OPEN", checkInAt: minutesAgo(40), checkInTrust: "HIGH" } });
    const tapState = await call("/members/presence", 200, keeper);
    assert.equal(tapState.needsConfirmation, true, "La base sin ubicación también pide confirmar presencia"); assert.equal(tapState.attendance.requiresLocation, false);
    await call("/members/presence", 400, keeper, "POST", { attendanceId: tapStay.id, inside: true, latitude: 0, longitude: 0, accuracy: 10, capturedAt: new Date().toISOString() });
    await call("/members/presence", 200, keeper, "POST", { attendanceId: tapStay.id, inside: true, tap: true });
    assert((await prisma.attendance.findUniqueOrThrow({ where: { id: tapStay.id } })).lastPresenceConfirmedAt, "La confirmación tocando cuenta como presencia verificada");
    assert(await prisma.auditLog.findFirst({ where: { entityId: tapStay.id, action: "PRESENCE_CONFIRMED" } }));
    await call("/attendance/me/close-remote", 400, keeper, "POST", { leftAt: new Date(Date.now() + 5 * 60000).toISOString() }); // hora futura
    const tapClosed = await call("/attendance/me/close-remote", 200, keeper, "POST", {});
    assert.equal(tapClosed.method, "REMOTE"); assert(tapClosed.workedMinutes >= 39, "Recién confirmado: cierra en el momento");
    // Se fue a la casa y lo cierra horas después: solo se acredita el ingreso + 30 min y queda marcado como tardío.
    const lateStay = await prisma.attendance.create({ data: { userId: keeperUser!.id, stationId: noGps.id, checkInQrId: noGpsQr.id, status: "OPEN", checkInAt: minutesAgo(8 * 60), checkInTrust: "HIGH" } });
    assert.equal((await call("/attendance/me/close-remote", 200, keeper)).late, true);
    const lateClose = await call("/attendance/me/close-remote", 200, keeper, "POST", { leftAt: minutesAgo(10).toISOString() });
    assert.equal(lateClose.method, "REMOTE_LATE"); assert.equal(lateClose.capped, true); assert(Math.abs(lateClose.workedMinutes - 30) <= 1, "Acredita 30 min, no 8 h");
    assert.equal((await prisma.attendance.findUniqueOrThrow({ where: { id: lateStay.id } })).checkOutMethod, "REMOTE_LATE");
    assert(await prisma.memberNotification.findFirst({ where: { dedupeKey: { startsWith: `remote-close-late:${lateStay.id}:` } } }), "Se avisa a jefatura del cierre tardío");
    // En la base con ubicación no alcanza con tocar: se exige el GPS.
    const centralQr = await prisma.qrChallenge.create({ data: { stationId: central.id, tokenHash: randomUUID(), expiresAt: new Date(Date.now() + 60000) } });
    const gpsStay = await prisma.attendance.create({ data: { userId: keeperUser!.id, stationId: central.id, checkInQrId: centralQr.id, status: "OPEN", checkInAt: minutesAgo(40), checkInTrust: "HIGH" } });
    await call("/members/presence", 400, keeper, "POST", { attendanceId: gpsStay.id, inside: true, tap: true });
    await call("/attendance/me/close-remote", 200, keeper, "POST", {});

    // --- Guía del personal: teléfono para llamar, orden por cargo, antigüedad y cursos ---
    await prisma.firefighterProfile.update({ where: { userId: bomberoUser!.id }, data: { phone: "3582 412345" } });
    const staffList = await call("/contacts/staff", 200, bombero);
    assert(staffList.some((p: { id: string; phone: string | null }) => p.id === bomberoUser!.id && p.phone === "3582 412345"), "Muestra el teléfono");
    const { rankPosition } = await import("../utils/people-order");
    const positions = staffList.map((p: { rank: string }) => rankPosition(p.rank));
    assert.deepEqual(positions, [...positions].sort((a: number, b: number) => a - b), "Ordenado por cargo");
    const { comparePeople } = await import("../utils/people-order");
    const older = { profile: { rank: "Bombero", fullName: "B", joinDate: new Date("2010-01-01") }, _count: { courses: 0 } };
    const newer = { profile: { rank: "Bombero", fullName: "A", joinDate: new Date("2020-01-01") }, _count: { courses: 9 } };
    const moreCourses = { profile: { rank: "Bombero", fullName: "C", joinDate: new Date("2010-01-01") }, _count: { courses: 3 } };
    assert(comparePeople({ profile: { rank: "Oficial" } }, older) < 0, "Oficial antes que bombero");
    assert(comparePeople(older, newer) < 0, "Mismo cargo: primero el más antiguo");
    assert(comparePeople(moreCourses, older) < 0, "Mismo cargo y antigüedad: primero el de más cursos");
    assert(comparePeople({ profile: { rank: "Aspirante" } }, { profile: { rank: "Aspirante menor" } }) < 0, "Aspirante menor al final del cuerpo activo");

    // --- En el cuartel: quien está por una guardia se distingue del resto ---
    const hourNow = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "America/Argentina/Buenos_Aires", hour: "2-digit", hourCycle: "h23" }).format(new Date()));
    const { stationDate: sd } = await import("../utils/station-time");
    const guardDate = hourNow < 8 ? sd(new Date(Date.now() - 86_400_000)) : sd();
    const period = hourNow >= 8 && hourNow < 20 ? "DAY" : "NIGHT";
    await prisma.shift.upsert({ where: { date_period: { date: new Date(guardDate), period } }, update: { assignments: { create: [{ userId: keeperUser!.id }] } }, create: { date: new Date(guardDate), period, startTime: period === "DAY" ? "08:00" : "20:00", endTime: period === "DAY" ? "20:00" : "08:00", shiftType: "Guardia", createdByUserId: users[0]!.id, assignments: { create: [{ userId: keeperUser!.id }] } } });
    const guardStay = await prisma.attendance.create({ data: { userId: keeperUser!.id, stationId: noGps.id, checkInQrId: noGpsQr.id, status: "OPEN", checkInAt: minutesAgo(5), checkInTrust: "HIGH" } });
    const bomberoStay = await prisma.attendance.create({ data: { userId: bomberoUser!.id, stationId: noGps.id, checkInQrId: noGpsQr.id, status: "OPEN", checkInAt: minutesAgo(35), checkInTrust: "HIGH" } });
    const presentNow = await call("/attendance/present", 200, officer);
    assert.equal(presentNow.find((r: { user: { id: string } }) => r.user.id === keeperUser!.id)?.onGuard, true, "Marca a quien está de guardia");
    assert.equal(presentNow.find((r: { user: { id: string } }) => r.user.id === bomberoUser!.id)?.onGuard, false, "Quien vino sin guardia no figura de guardia");

    // --- Aviso al celular para confirmar presencia (una vez por vencimiento) ---
    const { remindDuePresence } = await import("../modules/members/presence.service");
    assert((await remindDuePresence()) >= 1);
    assert(await prisma.memberNotification.findFirst({ where: { userId: bomberoUser!.id, dedupeKey: { startsWith: `presence:${bomberoStay.id}:` } } }), "Se avisa al celular");
    const again = await prisma.memberNotification.count({ where: { dedupeKey: { startsWith: `presence:${bomberoStay.id}:` } } });
    await remindDuePresence();
    assert.equal(await prisma.memberNotification.count({ where: { dedupeKey: { startsWith: `presence:${bomberoStay.id}:` } } }), again, "No se repite el mismo aviso");
    assert.equal(await prisma.memberNotification.count({ where: { dedupeKey: { startsWith: `presence:${guardStay.id}:` } } }), 0, "Recién ingresado: todavía no corresponde");
    await prisma.attendance.updateMany({ where: { id: { in: [guardStay.id, bomberoStay.id] } }, data: { status: "CLOSED", checkOutAt: new Date() } });


    // --- Buzón de sugerencias: anónimo de verdad, solo lo lee jefatura, se marca como leído ---
    assert.deepEqual(await call("/feedback/mine", 200, bombero), []);
    const anon = await call("/feedback", 201, bombero, "POST", { kind: "COMPLAINT", title: "Baños del cuartel", body: "Faltan elementos de limpieza seguido", anonymous: true });
    const named = await call("/feedback", 201, bombero, "POST", { kind: "IDEA", title: "Capacitación de RCP", body: "Propongo una práctica mensual", anonymous: false });
    await call("/feedback", 400, bombero, "POST", { kind: "SPAM", title: "x", body: "y", anonymous: true });
    const anonRow = await prisma.feedback.findUniqueOrThrow({ where: { id: anon.id } });
    assert.equal(anonRow.authorUserId, null, "El anónimo no guarda autor"); assert.equal(anonRow.sentAt, null, "Ni la hora exacta");
    assert.notEqual(anonRow.ownerKey, bomberoUser!.id, "La clave del dueño no es su id");
    assert(!(await prisma.auditLog.findFirst({ where: { entityId: anon.id } })), "No queda en la auditoría");
    const { flushRequestAudit } = await import("../middlewares/request-audit.middleware"); await flushRequestAudit();
    assert(!(await prisma.auditLog.findFirst({ where: { action: "HTTP_MUTATION", metadata: { path: ["route"], string_starts_with: "/api/feedback" } } })), "Ni en el registro de accesos");
    assert.equal((await prisma.feedback.findUniqueOrThrow({ where: { id: named.id } })).authorUserId, bomberoUser!.id);
    await call("/feedback", 403, bombero);
    const inbox = await call("/feedback", 200, officer);
    assert.equal(inbox.find((r: { id: string }) => r.id === anon.id).author, null, "Jefatura no ve quién lo envió");
    assert.match(inbox.find((r: { id: string }) => r.id === named.id).author.name, /.+/);
    assert(await prisma.memberNotification.findFirst({ where: { title: { contains: "Buzón" }, body: { startsWith: "Anónimo" } } }), "Jefatura recibe el aviso sin autor");
    await call(`/feedback/${anon.id}/read`, 403, bombero, "POST", {});
    await call(`/feedback/${anon.id}/read`, 200, officer, "POST", {});
    await call(`/feedback/${named.id}/read`, 200, officer, "POST", {});
    const mineAfter = await call("/feedback/mine", 200, bombero);
    assert.equal(mineAfter.length, 2); assert(mineAfter.every((m: { readAt: string | null }) => m.readAt), "La persona ve que se leyó");
    assert.equal((await call("/feedback/mine", 200, keeper)).length, 0, "Cada uno ve solo lo suyo");
    assert(await prisma.memberNotification.findFirst({ where: { userId: bomberoUser!.id, title: { contains: "leyó tu envío" } } }), "Al que firmó se le avisa");

    // --- Novedades públicas: sin sesión, solo lo publicado, sin datos personales ---
    assert.equal((await call("/public/posts", 200)).total, 0);
    await call("/public-posts", 403, bombero, "POST", { kind: "NEWS", title: "No permitido", summary: "Solo jefatura publica", body: "Texto de prueba" });
    const pic = (await sharp({ create: { width: 64, height: 48, channels: 3, background: "#c62828" } }).jpeg().toBuffer()).toString("base64");
    const news = await call("/public-posts", 201, officer, "POST", { kind: "TRAINING", title: "Capacitación de rescate vehicular", summary: "Práctica con equipo hidráulico en el cuartel", body: "Se practicó la extracción con herramientas hidráulicas.", happenedOn: new Date().toISOString().slice(0, 10), photos: [pic] });
    assert.equal((await call("/public/posts", 200)).total, 0, "El borrador no se ve");
    await call(`/public/posts/${news.id}`, 404);
    await call(`/public-posts/${news.id}/publish`, 200, officer, "POST", { revision: 1 });
    const pub = await call(`/public/posts/${news.id}`, 200);
    assert.equal(pub.photos.length, 1); assert.equal(pub.title, "Capacitación de rescate vehicular");
    const photoRes = await fetch(`${base}/public/posts/${news.id}/photos/${pub.photos[0].id}`);
    assert.equal(photoRes.status, 200); assert.equal(photoRes.headers.get("content-type"), "image/jpeg");
    assert(!("authorUserId" in pub), "No expone quién lo escribió");
    const openIncident = await prisma.incident.create({ data: { title: "Incendio de pastizal", type: "FIRE", description: "Prueba", location: "Ruta 8 km 600", createdByUserId: users[1]!.id } });
    await call(`/public-posts/incident-draft/${openIncident.id}`, 409, officer);
    await prisma.incident.update({ where: { id: openIncident.id }, data: { status: "CLOSED", closedAt: new Date(), closingReport: "Se controló el foco en 40 minutos." } });
    const incidentDraft = await call(`/public-posts/incident-draft/${openIncident.id}`, 200, officer);
    assert.match(incidentDraft.title, /Incendio en Ruta 8 km 600/); assert.match(incidentDraft.body, /controló el foco/);
    assert.deepEqual(incidentDraft.units, []); assert.equal(incidentDraft.peopleCount, 0); assert.match(incidentDraft.body, /No participaron otras instituciones/);
    // Con moviles, dotacion y otra institucion: el informe dice que moviles salieron, cuantas personas fueron y quien mas participo.
    const reportDeparture = await prisma.vehicleDeparture.create({ data: { operationKey: randomUUID(), requestHash: randomUUID().replace(/-/g, ""), assetId: engine.id, departedAt: new Date(Date.now() - 7200000), returnedAt: new Date(Date.now() - 3600000), purpose: "Incendio de pastizal", notes: "Prueba", createdByUserId: users[1]!.id } });
    await prisma.missionMovement.create({ data: { incidentId: openIncident.id, assetId: engine.id, driverUserId: bomberoUser!.id, leaderUserId: keeperUser!.id, createdByUserId: users[1]!.id, departedAt: new Date(Date.now() - 7200000), arrivedAt: new Date(Date.now() - 6900000), returnedAt: new Date(Date.now() - 3600000), departureId: reportDeparture.id, crew: { create: [{ userId: bomberoUser!.id }, { userId: keeperUser!.id }, { userId: users[2]!.id }] } } });
    await prisma.incidentAgency.create({ data: { incidentId: openIncident.id, agencyType: "POLICE", name: "Comisaría Sampacho", unit: "12", inCharge: "Sargento Gómez", createdByUserId: users[1]!.id } });
    const fullDraft = await call(`/public-posts/incident-draft/${openIncident.id}`, 200, officer);
    assert.deepEqual(fullDraft.units, ["5"]); assert.equal(fullDraft.peopleCount, 3);
    assert.deepEqual(fullDraft.agencies, ["Policía: Comisaría Sampacho, unidad 12, a cargo de Sargento Gómez"]);
    assert.match(fullDraft.body, /Móvil que salió: 5/); assert.match(fullDraft.body, /3 bomberos/); assert.match(fullDraft.body, /Comisaría Sampacho/);
    const report = await call("/public-posts", 201, officer, "POST", { kind: "INCIDENT", incidentId: openIncident.id, title: fullDraft.title, summary: fullDraft.summary, body: fullDraft.body, happenedOn: fullDraft.happenedOn, units: fullDraft.units, peopleCount: fullDraft.peopleCount, agencies: fullDraft.agencies });
    await call(`/public-posts/${report.id}/publish`, 200, officer, "POST", { revision: 1 });
    const publicReport = await call(`/public/posts/${report.id}`, 200);
    assert.deepEqual(publicReport.units, ["5"]); assert.equal(publicReport.peopleCount, 3); assert.equal(publicReport.agencies.length, 1);
    await call(`/public-posts/${news.id}/unpublish`, 200, officer, "POST", { revision: 2 });
    await call(`/public/posts/${news.id}`, 404);

    // --- Indumentaria: prendas gastadas que se siguen usando, para el encargado ---
    await call("/members/declarations", 201, bombero, "POST", { category: "CLOTHING", title: "Botas de intervención", details: "Botas personales", clothing: { brand: "Marca", model: "M1", size: "42", condition: "WORN", novelties: "Suela gastada" } });
    await call("/supplies/clothing-to-replace", 403, bombero);
    const toReplace = await call("/supplies/clothing-to-replace", 200, keeper);
    assert(toReplace.some((r: { title: string; clothingCondition: string; person: { id: string } }) => r.title === "Botas de intervención" && r.clothingCondition === "WORN" && r.person.id === bomberoUser!.id));

    // --- Buscador de materiales: en qué móvil y en qué baulera ---
    const searchVehicle = await prisma.vehicle.findFirstOrThrow({ where: { assetId: engine.id } });
    const box2 = await prisma.vehicleCompartment.create({ data: { vehicleId: searchVehicle.id, name: "Baulera 2" } });
    await prisma.vehicleInventoryItem.create({ data: { compartmentId: box2.id, name: "Destornillador plano", expectedQuantity: 2 } });
    const found = await call(`/equipment/materials/search?q=${encodeURIComponent("destornilladores")}`, 200, bombero);
    assert(found.vehicles.some((r: { name: string; compartment: string; vehicle: { unitNumber: string } }) => r.name === "Destornillador plano" && r.compartment === "Baulera 2" && r.vehicle.unitNumber === "5"), "Encuentra en qué móvil y baulera está (plural incluido)");
    assert.equal((await call(`/equipment/materials/search?q=${encodeURIComponent("DESTORNILLADÓR")}`, 200, bombero)).vehicles.length >= 1, true, "Sin importar mayúsculas ni acentos");
    assert.equal((await call("/equipment/materials/search?q=x", 200, bombero)).vehicles.length, 0);
    await prisma.vehicleInventoryItem.create({ data: { compartmentId: box2.id, name: "Cámara térmica", expectedQuantity: 1 } });
    assert((await call("/equipment/materials/search?q=camara%20termica", 200, bombero)).vehicles.some((r: { name: string }) => r.name === "Cámara térmica"), "Encuentra aunque se escriba sin tildes");

    // --- Sanciones: legajo, puntos y funciones del sistema ---
    const in5 = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10), todayIso = new Date().toISOString().slice(0, 10);
    await call("/sanctions", 403, bombero, "POST", { userId: keeperUser!.id, kind: "WARNING", reason: "No puede sancionar", startsOn: todayIso });
    await call("/sanctions", 400, officer, "POST", { userId: bomberoUser!.id, kind: "SUSPENSION", reason: "Suspensión sin restricción", startsOn: todayIso, endsOn: in5 });
    await call("/sanctions", 400, officer, "POST", { userId: bomberoUser!.id, kind: "OTHER", reason: "Restricción sin fecha de fin", startsOn: todayIso, restrictions: ["NO_DRIVING"] });
    const sanction = await call("/sanctions", 201, officer, "POST", { userId: bomberoUser!.id, kind: "SUSPENSION", reason: "Abandono de guardia sin aviso", startsOn: todayIso, endsOn: in5, points: 25, restrictions: ["SUSPENDED"] });
    assert(await prisma.memberNotification.findFirst({ where: { userId: bomberoUser!.id, title: { contains: "sanción" } } }), "Se avisa a la persona");
    const ownRecord = await call("/sanctions", 200, bombero);
    assert.equal(ownRecord[0].active, true, "La ve en su legajo");
    await call(`/sanctions?userId=${keeperUser!.id}`, 403, bombero);
    const blocked = await call("/incidents/logistics", 409, officer, "POST", { incidentId: third.id, assetId: engine.id, driverUserId: bomberoUser!.id, leaderUserId: bomberoUser!.id, userIds: [bomberoUser!.id], dispatchExceptionReason: "Sale con la sirena fallando: se usa bocina" });
    assert.match(blocked.message, /sanción vigente/, "Suspendido: no integra dotaciones");
    const rankBoard = await call(`/ranking?month=${todayIso.slice(0, 7)}`, 200, officer);
    const bomberoRow = rankBoard.rows.find((r: { userId: string }) => r.userId === bomberoUser!.id);
    assert.equal(bomberoRow.breakdown.sanctions, 25, "Descuenta puntos del ranking");
    assert.equal(typeof rankBoard.lowLine, "number");
    for (const r of rankBoard.rows as Array<{ points: number; low: boolean; rank: string }>) if (r.low) assert(r.points < rankBoard.lowLine, "En rojo solo quien está debajo de la mitad del promedio");
    assert(Math.abs(rankBoard.lowLine - rankBoard.average / 2) < 0.11, "La línea es la mitad del promedio");
    await call(`/sanctions/${sanction.id}/revoke`, 200, officer, "POST", { reason: "Se presentó el descargo y se aceptó", revision: sanction.revision });
    assert.equal((await call("/sanctions", 200, bombero))[0].active, false);
    const afterRevoke = await call(`/ranking?month=${todayIso.slice(0, 7)}`, 200, officer);
    assert.equal(afterRevoke.rows.find((r: { userId: string }) => r.userId === bomberoUser!.id).breakdown.sanctions, 0, "Sin efecto: no descuenta");
    const seniorityBoard = await call("/station/seniority", 200, officer);
    assert(seniorityBoard.people.every((p: { ranking: { lowLine: number } }) => typeof p.ranking.lowLine === "number"), "El escalafón muestra el ranking");

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
