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
