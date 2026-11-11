import { enableAutoStepUp } from "./step-up-test-helper";
import "dotenv/config";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";
import { stationDate } from "../utils/station-time";

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("No ejecutar en produccion");
  const original = process.env.DATABASE_URL!, schema = `business_verify_${randomBytes(8).toString("hex")}`;
  const url = new URL(original); url.searchParams.set("schema", schema);
  const root = new PrismaClient({ datasourceUrl: original });
  let db: PrismaClient | undefined, server: import("node:http").Server | undefined;
  try {
    execFileSync(process.execPath, [require.resolve("prisma/build/index.js"), "migrate", "deploy"], { env: { ...process.env, DATABASE_URL: url.toString() }, stdio: "pipe" });
    process.env.DATABASE_URL = url.toString(); const { prisma } = await import("../config/prisma"); db = prisma;
    const { app } = await import("../app"); server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server!.once("listening", resolve));
    const address = server.address(); assert(address && typeof address !== "string"); const base = `http://127.0.0.1:${address.port}/api`;
    let paths = 0;
    async function call(path: string, status: number, token?: string, method = "GET", body?: unknown) {
      if(path==="/inspections"&&method==="POST"&&status===201&&body&&!((body as any).draftId)){const input=body as any;const draft=await call("/inspections/drafts",201,token,"POST",{vehicleId:input.vehicleId});await call("/inspections/drafts/"+draft.id+"/participants",200,token,"PUT",{revision:draft.revision,userIds:input.responsibleUserIds});body={...input,draftId:draft.id,inspectionDate:stationDate(new Date(draft.startedAt)),inspectionTime:new Intl.DateTimeFormat("en-GB",{timeZone:"America/Argentina/Buenos_Aires",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).format(new Date(draft.startedAt))};}
      const request = () => fetch(base + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
      let response = await request();
      // This suite tests business flows, not throttling. Respect the real login limit.
      if (path === "/auth/login" && response.status === 429 && status !== 429) {
        const waitSeconds = Number(response.headers.get("Retry-After"));
        assert(Number.isFinite(waitSeconds) && waitSeconds >= 0 && waitSeconds <= 60);
        await response.text();
        console.log(`Esperando ${waitSeconds}s para respetar el limite de acceso de la API.`);
        await new Promise(resolve => setTimeout(resolve, (waitSeconds + 1) * 1000));
        response = await request();
      }
      const data = await response.json(); assert.equal(response.status, status, `${method} ${path}: ${JSON.stringify(data)}`); assert(!JSON.stringify(data).includes("passwordHash")); paths++; return data;
    }
    const password = randomUUID() + "!Aa9", passwordHash = await bcrypt.hash(password, 10), users: Array<{id:string;username:string}> = [], tokens: string[] = [];
    enableAutoStepUp(() => password);
    for (const [i, rank] of ["Oficial", "Sub oficial", "Bombero", "Aspirante menor", "Guardia"].entries()) {
      const person = await prisma.user.create({ data: { username: `business_test_${i}`, passwordHash, role: "FIREFIGHTER", profile: { create: { fullName: `Prueba reglas ${i}`, rank, dni: `REGLAS-${i}`, badge: `R-${i}` } } } }); users.push(person);
      const login = await call("/auth/login", 200, undefined, "POST", { username: person.username, password }); tokens.push(login.tokens.accessToken);
      assert.equal(login.user.role, i === 0 ? "ADMIN" : i === 1 ? "OPERATOR" : i === 4 ? "GUARD" : "FIREFIGHTER");
    }
    const [admin, sub, staff, minor, guard] = tokens;
    await prisma.user.update({where:{id:users[0]!.id},data:{financeChief:true}});
    await call("/alerts", 400, staff, "POST", {
      type: "OTHER",
      priority: "HIGH",
      location: "Lugar ficticio",
    });
    for (const token of tokens) {
      const alert = await call("/alerts", 201, token, "POST", {
        type: "OTHER",
        priority: "HIGH",
        location: "Lugar ficticio",
        description: "Alerta de prueba emitida por una cuenta autenticada",
      });
      assert(alert.createdBy);
      assert.equal(await prisma.memberNotification.count({ where: { dedupeKey: { startsWith: `alert:${alert.id}:` } } }), 0);
    }
    await call("/members/availability/available-now", 200, staff, "POST", {});
    const availableAlert = await call("/alerts", 201, admin, "POST", { type: "OTHER", priority: "HIGH", location: "Lugar ficticio", description: "Aviso para personal disponible" });
    assert.equal(await prisma.memberNotification.count({ where: { dedupeKey: `alert:${availableAlert.id}:${users[2]!.id}` } }), 1);
    assert.equal(await prisma.memberNotification.count({ where: { dedupeKey: `alert:${availableAlert.id}:${users[3]!.id}` } }), 0);
    const unavailableStart = new Date(Date.now() - 60_000).toISOString();
    await call("/members/availability", 201, staff, "POST", { startsAt: unavailableStart, endsAt: null });
    const unavailableAlert = await call("/alerts", 201, admin, "POST", { type: "OTHER", priority: "HIGH", location: "Lugar ficticio", description: "Aviso excluido por indisponibilidad" });
    assert.equal(await prisma.memberNotification.count({ where: { dedupeKey: `alert:${unavailableAlert.id}:${users[2]!.id}` } }), 0);
    await call("/members/availability/available-now", 200, staff, "POST", {});
    assert.equal(await prisma.memberNotification.count({ where: { dedupeKey: `alert:${unavailableAlert.id}:${users[2]!.id}` } }), 1);
    const courseData = { title: "Curso de prueba", provider: "Escuela ficticia", completedOn: stationDate() };
    const course = await call("/members/courses", 201, staff, "POST", courseData);
    await call("/members/courses", 409, staff, "POST", courseData);
    await call("/members/courses?scope=pending", 403, guard);
    assert.equal((await call("/members/courses", 200, minor)).length, 0);
    const reviewPath = `/members/courses/${course.id}/review`;
    await call(reviewPath, 403, staff, "POST", { status: "APPROVED" });
    await call(reviewPath, 400, sub, "POST", { status: "REJECTED" });
    await call(reviewPath, 200, sub, "POST", { status: "APPROVED" });
    await call(reviewPath, 409, admin, "POST", { status: "REJECTED", note: "Intento de segunda revision" });
    assert.equal((await call("/members/courses", 200, staff))[0].reviewer.username, users[1]!.username);
    const ownCourse = await call("/members/courses", 201, sub, "POST", courseData);
    await call(`/members/courses/${ownCourse.id}/review`, 403, sub, "POST", { status: "APPROVED" });
    await call("/alerts/notices", 403, staff);
    const notice = await call("/alerts/notices", 201, guard, "POST", { source: "Central ficticia", type: "OTHER", priority: "MEDIUM", location: "Ubicacion de prueba", notes: "Prueba aislada", referral: "Guardia" });
    assert.equal(notice.alertId, null);
    const noticeData = { source: "Aviso corregible", type: "OTHER", priority: "LOW", location: "Ubicacion inicial", notes: "Registro de prueba" };
    const correctable = await call("/alerts/notices", 201, guard, "POST", noticeData);
    const noticeCorrection = { ...noticeData, location: "Ubicacion corregida", revision: 1, reason: "Correccion de direccion informada" };
    await call(`/alerts/notices/${correctable.id}`, 403, staff, "PUT", noticeCorrection);
    await call(`/alerts/notices/${correctable.id}`, 200, guard, "PUT", noticeCorrection);
    await call(`/alerts/notices/${correctable.id}`, 409, sub, "PUT", noticeCorrection);
    const corrected = await prisma.dispatchNotice.findUniqueOrThrow({ where: { id: correctable.id } });
    assert.equal(corrected.location, noticeCorrection.location); assert.equal(corrected.operatorId, correctable.operatorId);
    assert.equal(corrected.receivedAt.toISOString(), correctable.receivedAt);
    const foreignNotice = await call("/alerts/notices", 201, sub, "POST", noticeData);
    await call(`/alerts/notices/${foreignNotice.id}`, 200, guard, "PUT", noticeCorrection); // B06: guardia corrige cualquier aviso abierto
    await call(`/alerts/notices/${foreignNotice.id}/cancel`, 200, guard, "POST", { revision: 2, reason: "Anulacion de aviso ajeno abierto" });
    await call(`/alerts/notices/${correctable.id}/cancel`, 400, guard, "POST", { revision: 2, reason: "breve" });
    const cancellation = { revision: 2, reason: "Aviso duplicado confirmado con central" };
    await call(`/alerts/notices/${correctable.id}/cancel`, 200, guard, "POST", cancellation);
    await call(`/alerts/notices/${correctable.id}/cancel`, 409, admin, "POST", cancellation);
    await call(`/alerts/notices/${correctable.id}/activate`, 409, sub, "POST");
    await call(`/alerts/notices/${correctable.id}`, 409, admin, "PUT", { ...noticeCorrection, revision: 3 });
    assert.equal(await prisma.auditLog.count({ where: { entityId: correctable.id, action: { in: ["NOTICE_CORRECTED", "NOTICE_CANCELLED"] } } }), 2);
    const raceNotice = await call("/alerts/notices", 201, sub, "POST", noticeData);
    const concurrentCorrections = await Promise.all(["Primera ubicacion", "Segunda ubicacion"].map(location => fetch(base + `/alerts/notices/${raceNotice.id}`, {
      method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${sub}` },
      body: JSON.stringify({ ...noticeCorrection, location }),
    })));
    assert.deepEqual(concurrentCorrections.map(response => response.status).sort(), [200, 409]); paths += 2;
    assert.equal(await prisma.auditLog.count({ where: { entityId: raceNotice.id, action: "NOTICE_CORRECTED" } }), 1);
    const raceActivation = await call("/alerts/notices", 201, sub, "POST", noticeData);
    const concurrentActivation = await Promise.all([
      fetch(base + `/alerts/notices/${raceActivation.id}/activate`, { method: "POST", headers: { Authorization: `Bearer ${sub}` } }),
      fetch(base + `/alerts/notices/${raceActivation.id}/cancel`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${sub}` }, body: JSON.stringify({ revision: 1, reason: "Anulacion concurrente de prueba" }) }),
    ]);
    const activationStatuses = concurrentActivation.map(response => response.status);
    assert(["201,409", "409,200"].includes(activationStatuses.join(",")), `Resultado concurrente inesperado: ${activationStatuses}`); paths += 2;
    const raceOutcome = await prisma.dispatchNotice.findUniqueOrThrow({ where: { id: raceActivation.id } });
    assert(Boolean(raceOutcome.cancelledAt) !== Boolean(raceOutcome.alertId), "El aviso nunca puede quedar anulado y convocado a la vez");
    const activated = await call(`/alerts/notices/${notice.id}/activate`, 201, sub, "POST");
    assert.equal((await call(`/alerts/notices/${notice.id}/activate`, 200, sub, "POST")).alertId, activated.alertId);
    await call(`/alerts/notices/${notice.id}`, 409, admin, "PUT", { ...noticeCorrection, revision: 2 });
    await call(`/alerts/notices/${notice.id}/cancel`, 409, admin, "POST", cancellation);
    const dispatched = await call(`/incidents/from-alert/${activated.alertId}`, 201, admin, "POST", { autoAssignResponders: false });
    assert.equal(dispatched.location, notice.location); assert.equal(dispatched.description, notice.notes);
    await call("/users", 403, guard); await call("/audit-logs", 403, guard); assert.equal((await call(`/members/profile/${users[2]!.id}`, 200, guard)).profile.dni, undefined); // C06: con emergencia activa solo datos de emergencia
    for (const path of ["/air/cylinders", "/air/compressors", "/fleet/fuel", "/fleet/water", "/operations/maintenance", "/compliance", "/compliance/summary"]) {
      await call(path, 403, staff); await call(path, 403, minor); await call(path, 200, guard); await call(path, 200, sub);
    }
    await call("/personal-equipment", 403, guard); await call("/personal-equipment", 403, staff); await call("/personal-equipment", 200, sub);
    const station = await prisma.station.create({ data: { name: "Base ficticia", latitude: -33, longitude: -64, radiusMeters: 100 } });
    const ledgerAsset=await prisma.asset.create({data:{name:"Movil de registros economicos",assetType:"VEHICLE",vehicle:{create:{unitNumber:"LEDGER-TEST"}}}});
    const fuelBody={operationKey:randomUUID(),assetId:ledgerAsset.id,occurredAt:new Date(Date.now()-7200000).toISOString(),liters:"36,500",costCents:120000,odometer:100,reason:"SERVICE",notes:"Carga ficticia"};
    const fuelEntry=await call("/fleet/fuel",201,guard,"POST",fuelBody);
    const fuelFix={revision:1,reason:"Se corrigio la lectura del surtidor",data:{...fuelBody,operationKey:randomUUID(),liters:"38,250"}};
    const fuelFixPath=`/fleet/fuel/${fuelEntry.id}/correct`;
    await call(fuelFixPath,403,guard,"POST",fuelFix);await call(fuelFixPath,403,staff,"POST",fuelFix);
    await call(fuelFixPath,409,sub,"POST",{...fuelFix,revision:99});
    const fixedFuel=await call(fuelFixPath,201,sub,"POST",fuelFix);
    assert.equal((await call(fuelFixPath,201,sub,"POST",fuelFix)).id,fixedFuel.id);
    await call(fuelFixPath,409,sub,"POST",{...fuelFix,reason:"Un motivo diferente no reutiliza la misma operacion"});
    const oldFuel=await prisma.fuelRecord.findUniqueOrThrow({where:{id:fuelEntry.id}});
    assert.equal(oldFuel.volumeMilliliters,36500);assert(oldFuel.voidedAt);
    assert.equal((await prisma.fuelRecord.findUniqueOrThrow({where:{id:fixedFuel.id}})).volumeMilliliters,38250);
    const fuelList=await call(`/fleet/fuel?assetId=${ledgerAsset.id}`,200,guard);assert.equal(fuelList.totals._sum.volumeMilliliters,38250);
    const secondFuel=await call("/fleet/fuel",201,guard,"POST",{...fuelBody,operationKey:randomUUID(),occurredAt:new Date().toISOString(),odometer:200});
    await call(`/fleet/fuel/${secondFuel.id}/correct`,409,admin,"POST",{revision:1,reason:"Esta correccion no debe pisar el odometro",data:{...fuelBody,operationKey:randomUUID(),occurredAt:new Date().toISOString(),odometer:50}});
    assert.equal((await prisma.fuelRecord.findUniqueOrThrow({where:{id:secondFuel.id}})).voidedAt,null);
    const waterBody={operationKey:randomUUID(),assetId:ledgerAsset.id,customer:"Cliente de prueba",destination:"Lugar ficticio",departedAt:new Date(Date.now()-3600000).toISOString(),returnedAt:new Date(Date.now()-1800000).toISOString(),startOdometer:100,endOdometer:120,tripCount:1,chargeCents:10000,leaderUserId:users[2]!.id,notes:"Viaje ficticio",crew:[{userId:users[2]!.id,compensationCents:2000}]};
    const waterEntry=await call("/fleet/water",201,guard,"POST",waterBody);
    const alternateWaterAsset=await prisma.asset.create({data:{name:"Móvil para control de solapamientos",assetType:"VEHICLE",vehicle:{create:{unitNumber:"CREW-OVERLAP"}}}});
    const overlapCrew=await call("/fleet/water",409,guard,"POST",{...waterBody,operationKey:randomUUID(),assetId:alternateWaterAsset.id});assert(overlapCrew.message.includes("personal"));
    await call(`/fleet/water/${waterEntry.id}/payment`,409,admin,"POST",{revision:1,kind:"CREW",userId:users[2]!.id,notes:"No pagar remuneración sin revisión independiente"});
    await call(`/finance/water/${waterEntry.id}/approve`,200,admin,"POST",{revision:1,note:"Revisión independiente de viaje e importes propuestos"});
    await call(`/fleet/water/${waterEntry.id}/payment`,403,guard,"POST",{revision:1,kind:"CREW",userId:users[2]!.id,notes:"Guardia no puede registrar pagos"});
    const waterFixPath=`/fleet/water/${waterEntry.id}/correct`,waterFix={revision:1,reason:"Correccion de destino en documento",data:{...waterBody,operationKey:randomUUID(),destination:"Destino corregido"}};
    await call(waterFixPath,403,guard,"POST",waterFix);
    await call(`/fleet/water/${waterEntry.id}/payment`,200,admin,"POST",{revision:2,kind:"CREW",userId:users[2]!.id,notes:"Constancia de pago ficticia"});
    await call(waterFixPath,409,admin,"POST",{...waterFix,revision:3});
    await call(`/fleet/water/${waterEntry.id}/payment`,200,admin,"POST",{revision:3,kind:"CREW",userId:users[2]!.id,reverse:true,notes:"Revertir constancia por error documental"});
    await call(`/fleet/water/${waterEntry.id}/payment`,200,admin,"POST",{revision:4,kind:"CLIENT",notes:"Constancia de cobro ficticia"});
    await call(waterFixPath,409,admin,"POST",{...waterFix,revision:5});
    await call(`/fleet/water/${waterEntry.id}/payment`,200,admin,"POST",{revision:5,kind:"CLIENT",reverse:true,notes:"Revertir constancia por error documental"});
    await call(waterFixPath,409,admin,"POST",waterFix);
    const fixedWater=await call(waterFixPath,201,admin,"POST",{...waterFix,revision:6});
    assert.equal((await call(waterFixPath,201,admin,"POST",{...waterFix,revision:6})).id,fixedWater.id);
    await call(`/fleet/water/${waterEntry.id}/payment`,409,admin,"POST",{revision:7,kind:"CLIENT",notes:"No debe cobrar un original reemplazado"});
    assert.equal(await prisma.waterTrip.count({where:{assetId:ledgerAsset.id,voidedAt:null}}),1);
    assert.equal((await prisma.waterTrip.findUniqueOrThrow({where:{id:waterEntry.id}})).destination,"Lugar ficticio");
    await prisma.user.update({where:{id:users[2]!.id},data:{isActive:false}});
    await prisma.asset.update({where:{id:ledgerAsset.id},data:{deletedAt:new Date()}});
    const historicalFix=await call(`/fleet/water/${fixedWater.id}/correct`,201,admin,"POST",{revision:1,reason:"Corregir observacion conservando dotacion historica",data:{...waterFix.data,operationKey:randomUUID(),notes:"Observacion historica corregida"}});
    assert.equal((await prisma.waterTripMember.findFirstOrThrow({where:{tripId:historicalFix.id}})).userId,users[2]!.id);
    await prisma.user.update({where:{id:users[2]!.id},data:{isActive:true}});
    await prisma.asset.update({where:{id:ledgerAsset.id},data:{deletedAt:null}});
    await call("/attendance/stations", 403, staff); await call("/attendance/stations", 200, guard);
    await call("/attendance/qr-challenges", 403, staff, "POST", { stationId: station.id });
    const qr = await call("/attendance/qr-challenges", 201, guard, "POST", { stationId: station.id });
    assert(Date.parse(qr.expiresAt) > Date.now());
    assert(Date.parse(qr.expiresAt) - Date.now() <= 30000);
    const renewedQr = await call("/attendance/qr-challenges", 201, guard, "POST", { stationId: station.id });
    assert((await prisma.qrChallenge.findUniqueOrThrow({ where: { id: qr.id } })).revokedAt);
    await call("/attendance/scan", 403, guard, "POST", { qrToken: renewedQr.qrToken, latitude: -33, longitude: -64, accuracy: 5, deviceFingerprint: "test-guard" });
    assert.equal(await prisma.attendance.count({ where: { userId: users[4]!.id } }), 0);
    const imported = await prisma.attendance.create({ data: { userId: users[2]!.id, stationId: station.id, status: "OPEN", checkInAt: new Date(Date.now() - 31 * 60000) } });
    assert.equal((await call("/members/presence", 200, staff)).needsConfirmation, false);
    await call(`/attendance/${imported.id}/close`, 403, staff, "POST", { reason: "Cierre no autorizado de prueba" });
    // E10: el cierre de un fichaje ajeno queda pendiente de una segunda autorizacion independiente.
    const closeRequest = await call(`/attendance/${imported.id}/close`, 200, guard, "POST", { reason: "Cierre autorizado de prueba" });
    assert.equal(closeRequest.pending, true);
    assert.equal((await prisma.attendance.findUniqueOrThrow({ where: { id: imported.id } })).status, "OPEN");
    assert.equal((await call(`/attendance/${imported.id}/close`, 200, guard, "POST", { reason: "Intento de cierre duplicado" })).correctionId, closeRequest.correctionId);
    assert.equal((await call("/attendance/corrections", 200, guard)).length, 1);
    await call("/attendance/corrections", 403, staff);
    await call(`/attendance/corrections/${closeRequest.correctionId}/decide`, 403, guard, "POST", { approve: true, note: "Guardia no autoriza" });
    await call(`/attendance/corrections/${closeRequest.correctionId}/decide`, 200, sub, "POST", { approve: true, note: "Segunda autorizacion de prueba" });
    await call(`/attendance/corrections/${closeRequest.correctionId}/decide`, 409, admin, "POST", { approve: true, note: "Decision duplicada" });
    const closedByCorrection = await prisma.attendance.findUniqueOrThrow({ where: { id: imported.id } });
    assert.equal(closedByCorrection.status, "CLOSED"); assert.equal(closedByCorrection.checkOutTrust, "MEDIUM");
    await call(`/attendance/${imported.id}/close`, 409, guard, "POST", { reason: "Intento de cierre duplicado" });
    // E09/E10: apertura manual con doble autorizacion cuando el GPS falla.
    const manualOpen = await call("/attendance/corrections", 201, guard, "POST", { userId: users[3]!.id, stationId: station.id, effectiveAt: new Date(Date.now() - 60000).toISOString(), reason: "GPS impreciso dentro del cuartel" });
    await call("/attendance/corrections", 403, guard, "POST", { userId: users[4]!.id, stationId: station.id, effectiveAt: new Date(Date.now() - 60000).toISOString(), reason: "No puede abrir su propio fichaje" });
    assert.equal(await prisma.attendance.count({ where: { userId: users[3]!.id, status: "OPEN" } }), 0);
    await call(`/attendance/corrections/${manualOpen.correctionId}/decide`, 200, admin, "POST", { approve: false, note: "No consta en el cuartel" });
    assert.equal(await prisma.attendance.count({ where: { userId: users[3]!.id, status: "OPEN" } }), 0);
    const manualOpen2 = await call("/attendance/corrections", 201, sub, "POST", { userId: users[3]!.id, stationId: station.id, effectiveAt: new Date(Date.now() - 30000).toISOString(), reason: "GPS impreciso dentro del cuartel" });
    await call(`/attendance/corrections/${manualOpen2.correctionId}/decide`, 403, sub, "POST", { approve: true, note: "No puede autorizar su pedido" });
    await call(`/attendance/corrections/${manualOpen2.correctionId}/decide`, 200, admin, "POST", { approve: true, note: "Presencia verificada en persona" });
    const manualRow = await prisma.attendance.findFirstOrThrow({ where: { userId: users[3]!.id, status: "OPEN" } });
    assert(manualRow.checkInQrId?.startsWith("manual:")); assert.equal(manualRow.checkInTrust, "MEDIUM");
    await prisma.attendanceCorrection.deleteMany({ where: { attendanceId: manualRow.id } }); await prisma.attendance.delete({ where: { id: manualRow.id } });
    const futureAttendance = await prisma.attendance.create({ data: { userId: users[2]!.id, stationId: station.id, status: "OPEN", checkInAt: new Date(Date.now() + 60000) } });
    await call(`/attendance/${futureAttendance.id}/close`, 400, guard, "POST", { reason: "No cerrar registros con fecha futura" });
    await prisma.attendance.delete({ where: { id: futureAttendance.id } });
    await call(`/attendance/qr-challenges/${qr.id}/revoke`, 200, guard, "POST", {});
    assert((await prisma.qrChallenge.findUniqueOrThrow({ where: { id: qr.id } })).revokedAt);
    assert((await prisma.qrChallenge.findUniqueOrThrow({ where: { id: renewedQr.id } })).revokedAt);
    const message = await call("/chat/messages", 201, staff, "POST", { body: "Mensaje de prueba de negocio" });
    await call(`/chat/messages/${message.id}`, 403, guard, "PATCH", { body: "Guardia no modera comunicaciones" });
    await call(`/chat/messages/${message.id}`, 403, minor, "PATCH", { body: "Otro integrante tampoco edita" });
    await call(`/chat/messages/${message.id}`, 403, sub, "PATCH", { body: "Suboficial corrige mensaje ajeno" }); // N02: nadie edita mensajes ajenos
    const beforeEditNotices = await prisma.memberNotification.count({ where: { title: { startsWith: "Un mensaje fue editado" } } });
    await call(`/chat/messages/${message.id}`, 200, staff, "PATCH", { body: "El autor corrige su propio mensaje" });
    assert.equal(await prisma.memberNotification.count({ where: { title: { startsWith: "Un mensaje fue editado" } } }) - beforeEditNotices, users.length - 1); // N05
    await call(`/chat/messages/${message.id}/pin`, 200, sub, "PATCH", { isPinned: true });
    await call(`/chat/messages/${message.id}`, 200, admin, "DELETE", {});
    const alert = await prisma.alert.create({ data: { type: "OTHER", priority: "HIGH", location: "Lugar ficticio", description: "Alerta solo de prueba", createdByUserId: users[0]!.id } });
    // F09: quien no integra la convocatoria puede ver la alerta, pero no responder.
    await call(`/alerts/${alert.id}/respond`, 403, staff, "POST", { response: "GOING" });
    assert.equal((await call(`/alerts/${alert.id}`, 200, staff)).viewerIsRecipient, false);
    for (const person of users) await prisma.memberNotification.create({ data: { userId: person.id, title: "Nueva alerta operativa: prioridad alta", href: "/alerts", dedupeKey: `alert:${alert.id}:${person.id}` } });
    assert.equal((await call(`/alerts/${alert.id}`, 200, staff)).viewerIsRecipient, true);
    const vote = await call(`/alerts/${alert.id}/respond`, 200, staff, "POST", { response: "GOING" });
    const repeated = await call(`/alerts/${alert.id}/respond`, 200, staff, "POST", { response: "GOING" });
    assert.equal(repeated.id, vote.id); assert.equal(repeated.respondedAt, vote.respondedAt);
    // Decision del cuartel: la respuesta queda fija una vez registrada.
    await call(`/alerts/${alert.id}/respond`, 409, staff, "POST", { response: "NOT_GOING" });
    assert.equal((await prisma.alertResponse.findUniqueOrThrow({ where: { id: vote.id } })).response, "GOING");
    const falseAlarm = await prisma.alert.create({ data: { type: "OTHER", priority: "HIGH", location: "Lugar ficticio", description: "Falsa alarma ficticia", createdByUserId: users[0]!.id } });
    const falseAlarmIncident = await prisma.incident.create({ data: { alertId: falseAlarm.id, title: "Salida por falsa alarma", type: "OTHER", location: "Lugar ficticio", description: "La salida movilizada se conserva", createdByUserId: users[0]!.id } });
    await call(`/alerts/${falseAlarm.id}/cancel`, 403, staff, "PATCH", { reason: "Intento sin permiso" });
    await call(`/alerts/${falseAlarm.id}/cancel`, 400, guard, "PATCH", { reason: "corto" });
    const cancelledFalseAlarm = await call(`/alerts/${falseAlarm.id}/cancel`, 200, guard, "PATCH", { reason: "Se verificó que el llamado era una falsa alarma" });
    assert.equal(cancelledFalseAlarm.status, "CANCELLED");
    assert.equal(cancelledFalseAlarm.incident.id, falseAlarmIncident.id);
    assert.equal((await prisma.incident.findUniqueOrThrow({ where: { id: falseAlarmIncident.id } })).status, "OPEN");
    await call(`/alerts/${falseAlarm.id}/cancel`, 409, guard, "PATCH", { reason: "Intento de cancelacion repetido" });
    const asset = await prisma.asset.create({ data: { name: "Movil de reglas", assetType: "VEHICLE", vehicle: { create: { unitNumber: "REGLAS", compartments: { create: { name: "Cabina", items: { create: { name: "Linterna", expectedQuantity: 1 } } } } } } }, include: { vehicle: { include: { compartments: { include: { items: true } } } } } });
    const today = stationDate(), future = stationDate(new Date(Date.now() + 7 * 86400000));
    const group = await call("/members/groups", 201, admin, "POST", { name: "Grupo vigente", startsOn: today, repeatWeeks: 4, userIds: [users[2]!.id, users[3]!.id] });
    const { startControlReminderJob } = await import("../modules/members/control-reminder-job");
    const stopReminders = startControlReminderJob();
    try {
      for (let i = 0; i < 60 && await prisma.memberNotification.count({ where: { dedupeKey: { startsWith: `control:${group.id}:` } } }) < 2; i++) await new Promise((resolve) => setTimeout(resolve, 50));
      assert.equal(await prisma.memberNotification.count({ where: { dedupeKey: { startsWith: `control:${group.id}:` } } }), 2);
    } finally { stopReminders(); }
    await call("/members/groups", 201, admin, "POST", { name: "Grupo futuro", startsOn: future, repeatWeeks: 4, userIds: [users[4]!.id] });
    await call("/members/groups", 403, guard, "POST", { name: "No administrar grupos", startsOn: today, repeatWeeks: 4, userIds: [] });
    const inspection = { vehicleId: asset.vehicle!.id, inspectionDate: today, inspectionTime: new Intl.DateTimeFormat("en-GB", { timeZone: "America/Argentina/Buenos_Aires", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date()), leaderUserId: users[3]!.id, responsibleUserIds: [users[3]!.id], items: [{ inventoryItemId: asset.vehicle!.compartments[0]!.items[0]!.id, observedQuantity: 1, result: "OK" }] };
    await call("/inspections", 403, minor, "POST", inspection);
    const currentQr = await call("/attendance/qr-challenges", 201, guard, "POST", { stationId: station.id });
    for (const [index, token] of [minor, staff].entries()) {
      const scan = await call("/attendance/scan", 200, token, "POST", { qrToken: currentQr.qrToken, latitude: -33, longitude: -64, accuracy: 5, deviceFingerprint: "qr-test-device-" + index });
      assert.equal(scan.shouldPromptAvailability, index === 0);
    }
    const inspectionRow = await call("/inspections", 201, minor, "POST", inspection);
    const late=await prisma.user.create({data:{username:"late_control_test",passwordHash,role:"FIREFIGHTER",profile:{create:{rank:"Bombero",fullName:"Participante tardío",dni:"LATE-CONTROL",badge:"LATE"}}}});
    const lateSession=await prisma.authSession.create({data:{userId:late.id,refreshTokenHash:randomBytes(32).toString("hex"),expiresAt:new Date(Date.now()+3600000)}});
    const {signAccessToken}=await import("../utils/jwt");
    const lateToken=signAccessToken({userId:late.id,role:"FIREFIGHTER",sessionId:lateSession.id});
    await call("/members/groups/"+group.id,200,admin,"PUT",{name:"Grupo vigente",startsOn:today,repeatWeeks:4,revision:1,userIds:[users[2]!.id,users[3]!.id,late.id]});
    const draft=await call("/inspections/drafts",201,minor,"POST",{vehicleId:inspection.vehicleId});
    assert(!(await call("/inspections/drafts/"+draft.id,200,minor)).candidates.some((p:{userId:string})=>p.userId===late.id));
    await call("/inspections/drafts/"+draft.id+"/participants",403,minor,"PUT",{revision:1,userIds:[users[3]!.id,late.id]});
    await call("/attendance/scan",200,lateToken,"POST",{qrToken:currentQr.qrToken,latitude:-33,longitude:-64,accuracy:5,deviceFingerprint:"late-test-device"});
    const joined=await call("/inspections/drafts/"+draft.id+"/participants",200,minor,"PUT",{revision:1,userIds:[users[3]!.id,late.id]});
    assert(new Date(joined.participants.find((p:{userId:string})=>p.userId===late.id).joinedAt)>=new Date(draft.startedAt));
    const lateControl=await call("/inspections",201,minor,"POST",{...inspection,draftId:draft.id,responsibleUserIds:[users[3]!.id,late.id]});
    await call("/inspections/drafts/"+draft.id+"/participants",409,minor,"PUT",{revision:joined.revision,userIds:[users[3]!.id,late.id,users[2]!.id]});
    assert((await call(`/inspections/${lateControl.id}/confirm`,200,lateToken,"POST",{})).complete);
    const multi = await call("/inspections", 201, minor, "POST", { ...inspection, responsibleUserIds: [users[3]!.id, users[2]!.id] });
    assert.equal(multi.confirmationsComplete, false);
    const attendanceForSignature=await prisma.attendance.findFirstOrThrow({where:{userId:users[2]!.id,status:"OPEN"}});
    await prisma.attendance.update({where:{id:attendanceForSignature.id},data:{checkInAt:new Date(Date.now()+120000)}});
    await call(`/inspections/${multi.id}/confirm`,403,staff,"POST",{});
    assert.equal((await prisma.inspectionResponsible.findUniqueOrThrow({where:{inspectionId_userId:{inspectionId:multi.id,userId:users[2]!.id}}})).confirmedAt,null);
    await prisma.attendance.update({where:{id:attendanceForSignature.id},data:{checkInAt:attendanceForSignature.checkInAt}});
    assert.equal((await prisma.asset.findUniqueOrThrow({ where: { id: asset.id } })).status, "MAINTENANCE");
    await call(`/inspections/${multi.id}/confirm`, 403, admin, "POST", {});
    assert.equal((await call(`/inspections/${multi.id}/confirm`, 200, minor, "POST", {})).complete, false);
    assert.equal((await call(`/inspections/${multi.id}/confirm`, 200, staff, "POST", {})).complete, true);
    assert.equal((await call(`/inspections/${multi.id}/confirm`, 200, staff, "POST", {})).complete, true);
    assert.equal(await prisma.auditLog.count({ where: { entityId: multi.id, action: "INSPECTION_PARTICIPATION_CONFIRMED" } }), 1);
    const faulty = await call("/inspections", 201, minor, "POST", { ...inspection, responsibleUserIds: [users[3]!.id, users[2]!.id], items: [{ ...inspection.items[0], observedQuantity: 0, result: "MISSING", observations: "Linterna ausente en prueba" }] });
    assert(faulty.repairTaskId);
    const repair = await prisma.workTask.findUniqueOrThrow({ where: { id: faulty.repairTaskId }, include: { members: true, maintenanceJob: true } });
    assert.equal(repair.priority, "HIGH"); assert(repair.dueOn);
    assert.equal(repair.members[0]!.userId, users[3]!.id); assert(repair.maintenanceJob!.blocksOperation);
    const planning={revision:1,dueOn:future,priority:"URGENT",responsibleUserId:users[2]!.id,notes:"Reprogramar la reparación y designar responsable"};
    await call(`/work/tasks/${repair.id}/plan`,403,staff,"POST",planning);
    await call(`/work/tasks/${repair.id}/plan`,403,guard,"POST",planning);
    await call(`/work/tasks/${repair.id}/plan`,400,sub,"POST",{...planning,responsibleUserId:null});
    await call(`/work/tasks/${repair.id}/plan`,200,sub,"POST",planning);
    await call(`/work/tasks/${repair.id}/plan`,409,admin,"POST",planning);
    const planned=await prisma.workTask.findUniqueOrThrow({where:{id:repair.id},include:{maintenanceJob:true}});
    assert.equal(planned.priority,"URGENT");assert.equal(planned.maintenanceJob!.responsibleUserId,users[2]!.id);
    assert.equal(planned.dueOn!.toISOString().slice(0,10),planned.maintenanceJob!.dueAt!.toISOString().slice(0,10));
    await call(`/inspections/${faulty.id}/confirm`, 200, staff, "POST", {});
    const creditBoard=await call("/ranking?month="+stationDate().slice(0,7),200,admin);assert.equal(creditBoard.rows.find((r:{userId:string})=>r.userId===users[3]!.id).counters.inspections,1,"Repetir controles del mismo móvil en la semana no multiplica puntos");
    assert.equal((await prisma.asset.findUniqueOrThrow({ where: { id: asset.id } })).status, "MAINTENANCE");
    await call(`/work/tasks/${repair.id}/submit`, 400, minor, "POST", { revision: 1, completedAt: new Date().toISOString(), notes: "No debe aceptar reparacion sin evidencia" });
    const correction = { revision: 1, reason: "Error de redaccion en la constancia", amendment: "Aclaracion administrativa de prueba" };
    await call(`/inspections/${inspectionRow.id}`, 403, guard, "PATCH", correction); // H12: rectifican admin, oficial y suboficial
    await call(`/inspections/${inspectionRow.id}`, 200, admin, "PATCH", correction);
    await call(`/inspections/${inspectionRow.id}`, 409, admin, "PATCH", correction);
    await call(`/inspections/${inspectionRow.id}`, 200, admin, "DELETE", { revision: 2, reason: "Se requiere repetir la verificacion fisica" });
    assert.equal((await prisma.asset.findUniqueOrThrow({ where: { id: asset.id } })).status, "MAINTENANCE");
    assert.equal(await prisma.inspectionItem.count({ where: { inspectionId: inspectionRow.id } }), 1);
    await call(`/inspections/${inspectionRow.id}`, 409, admin, "DELETE", { revision: 3, reason: "Intento de anulacion duplicada" });
    await call("/inspections", 403, admin, "POST", { ...inspection, leaderUserId: users[0]!.id, responsibleUserIds: [users[0]!.id] });
    await call("/inspections", 403, guard, "POST", { ...inspection, leaderUserId: users[4]!.id, responsibleUserIds: [users[4]!.id] });
    await call("/inspections", 403, staff, "POST", inspection);
    await call("/inspections", 400, minor, "POST", { ...inspection, responsibleUserIds: [users[3]!.id, users[4]!.id] }); // H04: se admiten ayudantes de otros grupos; falla solo por no tener borrador
    await call(`/members/groups/${group.id}`, 200, admin, "PUT", { name: "Grupo vigente", startsOn: future, repeatWeeks: 4, userIds: [users[2]!.id, users[3]!.id], revision: 2 });
    await call("/inspections", 403, minor, "POST", inspection);
    const futureDay = stationDate(new Date(Date.now() + 3 * 86400000));
    const schedule = { date: futureDay, period: "DAY", notes: "Agenda ficticia", assignedUserIds: [users[4]!.id] };
    await call("/shifts", 403, staff, "POST", schedule);
    await call("/shifts", 403, guard, "POST", schedule); // M01: programan guardias solo jefatura y administracion
    // D07: una ausencia programada bloquea nuevas asignaciones de guardia superpuestas.
    const absence = await call("/members/availability", 201, minor, "POST", { startsAt: new Date(Date.now() + 2 * 86400000).toISOString(), endsAt: new Date(Date.now() + 5 * 86400000).toISOString() });
    await call("/shifts", 409, sub, "POST", { ...schedule, assignedUserIds: [users[3]!.id] });
    await call(`/members/availability/${absence.id}`, 200, minor, "DELETE");
    const shift = await call("/shifts", 201, sub, "POST", schedule);
    assert(await prisma.memberNotification.findFirst({ where: { userId: users[4]!.id, title: { startsWith: "Guardia asignada" } } }));
    // M02: intercambio entre bomberos con aprobacion de jefatura; bloqueado a menos de 24 h.
    await call(`/shifts/${shift.id}/swap`, 403, staff, "POST", { toUserId: users[3]!.id, reason: "No integra la guardia que quiere cambiar" });
    await call(`/shifts/${shift.id}/swap`, 400, guard, "POST", { toUserId: users[4]!.id, reason: "No puede intercambiar consigo mismo" });
    const swap = await call(`/shifts/${shift.id}/swap`, 201, guard, "POST", { toUserId: users[2]!.id, reason: "Compromiso familiar ineludible" });
    await call(`/shifts/${shift.id}/swap`, 409, guard, "POST", { toUserId: users[3]!.id, reason: "Segundo pedido simultaneo de prueba" });
    await call(`/shifts/swaps/${swap.id}/decide`, 409, sub, "POST", { approve: true, note: "Aun no fue aceptado" });
    await call(`/shifts/swaps/${swap.id}/answer`, 403, minor, "POST", { accept: true });
    await call(`/shifts/swaps/${swap.id}/answer`, 200, staff, "POST", { accept: true });
    await call(`/shifts/swaps/${swap.id}/decide`, 403, staff, "POST", { approve: true, note: "Sin permiso de jefatura" });
    assert((await call("/shifts/swaps", 200, sub)).some((row: { id: string }) => row.id === swap.id));
    await call(`/shifts/swaps/${swap.id}/decide`, 200, sub, "POST", { approve: true, note: "Intercambio aprobado en prueba" });
    assert.deepEqual((await prisma.shiftAssignment.findMany({ where: { shiftId: shift.id } })).map(row => row.userId), [users[2]!.id]);
    const soonShift = await prisma.shift.create({ data: { date: new Date(stationDate()), period: "NIGHT", shiftType: "Guardia nocturna", startTime: "20:00", endTime: "08:00", createdByUserId: users[0]!.id, assignments: { create: { userId: users[4]!.id } } } });
    await call(`/shifts/${soonShift.id}/swap`, 409, guard, "POST", { toUserId: users[3]!.id, reason: "Faltan menos de veinticuatro horas" });
    await prisma.shift.delete({ where: { id: soonShift.id } });
    await call(`/shifts/${shift.id}`, 200, sub, "PUT", { ...schedule, period: "NIGHT" });
    await call(`/shifts/${shift.id}`, 200, sub, "DELETE", {});
    const past = stationDate(new Date(Date.now() - 3 * 86400000));
    const actualShift = await prisma.shift.create({ data: { date: new Date(past), period: "DAY", shiftType: "Guardia ficticia", startTime: "08:00", endTime: "20:00", createdByUserId: users[0]!.id, assignments: { create: { userId: users[2]!.id } } } });
    const act = { kind: "SHIFT_REPORT", title: "Acta ficticia de guardia", category: "Guardia", body: "Novedades ficticias registradas por guardia", shiftId: actualShift.id };
    const report = await call("/operations/documents", 201, guard, "POST", act);
    assert.equal((await call("/operations/documents?kind=SHIFT_REPORT", 200, staff)).length, 0);
    assert.equal((await call("/operations/documents?kind=SHIFT_REPORT", 200, sub)).length, 1);
    await call(`/operations/documents/${report.id}`, 200, sub, "PUT", { ...act, revision: 1 });
    await call(`/operations/documents/${report.id}/status`, 200, guard, "PATCH", { revision: 2, status: "PUBLISHED" });
    const rectification = { revision: 3, reason: "Corregir una omision de la planilla ficticia" };
    await call(`/operations/documents/${report.id}/rectify`, 403, staff, "POST", rectification);
    const rectified = await call(`/operations/documents/${report.id}/rectify`, 201, admin, "POST", rectification);
    await call(`/operations/documents/${report.id}/rectify`, 409, sub, "POST", rectification);
    assert.equal((await prisma.operationalDocument.findUniqueOrThrow({where:{id:report.id}})).status,"PUBLISHED");
    await call(`/operations/documents/${rectified.id}`, 200, admin, "PUT", { ...act, body: "Texto rectificado manteniendo trazabilidad", revision: 1 });
    await call(`/operations/documents/${rectified.id}/status`, 200, admin, "PATCH", { revision: 2, status: "PUBLISHED" });
    const sourceDoc = await prisma.operationalDocument.findUniqueOrThrow({where:{id:report.id}});
    assert.equal(sourceDoc.status,"ARCHIVED"); assert.equal(sourceDoc.body,act.body);
    assert(sourceDoc.publicationContext);
    assert.equal((await call("/operations/documents?kind=SHIFT_REPORT", 200, minor)).length, 0);
    const job = await call("/operations/maintenance", 201, guard, "POST", { assetId: asset.id, title: "Limpiar material", description: "Limpieza ficticia y control del material", blocksOperation: true, publishTask: true });
    const tasks = await call("/work/tasks", 200, staff); const task = tasks.items.find((t: { maintenanceJobId: string }) => t.maintenanceJobId === job.id); assert(task);
    const legacyJob = await call("/operations/maintenance", 201, guard, "POST", { assetId: asset.id, title: "Trabajo sin publicar", description: "Trabajo ficticio reservado hasta asignar personal", blocksOperation: false, publishTask: false });
    await call(`/operations/maintenance/${legacyJob.id}/task`, 403, staff, "POST", {});
    const publishedTask = await call(`/operations/maintenance/${legacyJob.id}/task`, 200, guard, "POST", {});
    assert.equal((await call(`/operations/maintenance/${legacyJob.id}/task`, 200, admin, "POST", {})).id, publishedTask.id);
    await call(`/work/tasks/${task.id}/claim`, 200, staff, "POST", { revision: task.revision });
    await call(`/work/tasks/${task.id}/claim`, 409, minor, "POST", { revision: task.revision });
    await call(`/work/tasks/${task.id}/claim`, 200, minor, "POST", { revision: task.revision + 1 });
    await call(`/work/tasks/${task.id}/submit`, 200, staff, "POST", { revision: task.revision + 2, notes: "Trabajo ficticio realizado por el equipo", completedAt: new Date().toISOString() });
    await call(`/work/tasks/${task.id}/review`, 403, guard, "POST", { revision: task.revision + 3, status: "VERIFIED", notes: "Guardia no verifica tareas" });
    await call(`/work/tasks/${task.id}/review`, 200, admin, "POST", { revision: task.revision + 3, status: "VERIFIED", notes: "Verificacion ficticia independiente" });
    assert.equal((await call("/work/tasks?status=VERIFIED", 200, staff)).items.length, 0);
    assert.equal((await call("/work/tasks?status=VERIFIED", 200, guard)).items.length, 0);
    assert.equal((await call("/work/tasks?status=VERIFIED", 200, sub)).items.length, 1);
    assert.equal((await prisma.asset.findUniqueOrThrow({ where: { id: asset.id } })).status, "MAINTENANCE");
    const participation = await call("/members/participations", 201, staff, "POST", { userId: users[2]!.id, shiftId: actualShift.id, startedAt: `${past}T09:00:00-03:00`, endedAt: `${past}T10:00:00-03:00`, notes: "Declaracion personal ficticia de asistencia" });
    assert.equal(participation.verifiedAt, null);
    await call(`/members/participations?userId=${users[2]!.id}`, 403, staff); await call(`/members/participations?userId=${users[2]!.id}`, 403, guard);
    assert.equal((await call(`/members/statistics/${users[2]!.id}`, 200, staff)).attendedShifts, 0);
    await call(`/members/participations/${participation.id}/verify`, 200, sub, "POST", { revision: 1 });
    assert.equal((await call(`/members/statistics/${users[2]!.id}`, 200, staff)).attendedShifts, 1);
    const clothing = await call("/members/declarations", 201, staff, "POST", { category: "CLOTHING", title: "Chaqueton ficticio", details: "Sin novedades", clothing: { brand: "Prueba", model: "Modelo", size: "M", condition: "OK", novelties: "Sin novedades" } }); assert.equal(clothing.clothingSize, "M");
    await call(`/members/declarations?category=CLOTHING&userId=${users[2]!.id}`, 403, sub);
    await call(`/members/declarations?category=CLOTHING&userId=${users[2]!.id}`, 403, guard);
    await call("/equipment-requests", 201, staff, "POST", { category: "GLOVES", size: "M", reason: "Necesito guantes para reemplazar los anteriores" });
    await call(`/alerts/${alert.id}/respond`,200,guard,"POST",{response:"GOING"});
    const incident = await prisma.incident.create({ data: { alertId:alert.id, title: "Incidente ficticio", type: "OTHER", location: "Lugar ficticio", description: "Caso para probar permisos", createdByUserId: users[0]!.id } });
    await call(`/incidents/${incident.id}`, 403, staff, "PATCH", { title: "No permitido" });
    await call(`/incidents/${incident.id}`, 200, guard, "PATCH", { title: "Incidente corregido por guardia" });
    const missionAsset = await prisma.asset.create({data:{name:"Movil de despliegue ficticio",assetType:"VEHICLE",status:"OPERATIONAL",lastCheckDate:new Date(),vehicle:{create:{unitNumber:"MISSION-TEST"}}}});
    const missionBody = {incidentId:incident.id,assetId:missionAsset.id,driverUserId:users[2]!.id,leaderUserId:users[2]!.id,userIds:[users[2]!.id]};
    await call("/incidents/logistics",403,staff,"POST",missionBody);
    await call("/incidents/logistics",403,guard,"POST",missionBody);
    const permitBody={assetId:missionAsset.id,userId:users[2]!.id,requiredClass:"B1",validUntil:futureDay,reason:"Documentacion y conduccion verificadas en prueba",revision:0};
    await call("/incidents/logistics/authorizations",403,guard,"PUT",permitBody);
    await call("/incidents/logistics/authorizations",400,sub,"PUT",permitBody);
    await call("/incidents/logistics",403,guard,"POST",missionBody);
    const missionLicenseData={category:"DRIVER_LICENSE",title:"Licencia ficticia para mision",details:"Habilitacion de prueba",license:{number:"TEST-MISSION",issuer:"Emisor ficticio",classes:["B1"],issuedOn:past,expiresOn:futureDay}};
    const missionLicense=await call("/members/declarations",201,staff,"POST",missionLicenseData);
    // J03: la habilitacion rige hasta el vencimiento de la licencia, sin importar la fecha enviada.
    const firstPermit=await call("/incidents/logistics/authorizations",200,sub,"PUT",{...permitBody,validUntil:stationDate(new Date(Date.now()+100*86400000))});
    assert.equal(firstPermit.validUntil.slice(0,10),futureDay);
    await call("/incidents/logistics/authorizations",409,sub,"PUT",permitBody);
    await prisma.attendance.updateMany({where:{userId:users[2]!.id,status:"OPEN"},data:{checkInAt:new Date(Date.now()-31*60000),lastPresenceConfirmedAt:null}});
    const revoke={assetId:missionAsset.id,userId:users[2]!.id,revision:1,reason:"Retiro preventivo de habilitación en prueba"};
    await call("/incidents/logistics/authorizations/revoke",403,guard,"POST",revoke);
    await call("/incidents/logistics/authorizations/revoke",200,sub,"POST",revoke);
    await call("/incidents/logistics/authorizations/revoke",409,sub,"POST",revoke);
    await call("/incidents/logistics",403,guard,"POST",missionBody);
    await call("/incidents/logistics/authorizations",200,sub,"PUT",{...permitBody,revision:2});
    await call(`/members/declarations/${missionLicense.id}`,200,staff,"PUT",{...missionLicenseData,revision:1,license:{...missionLicenseData.license,number:"TEST-MISSION-RENEWED"}});
    const outdatedOptions=await call("/incidents/logistics/options",200,sub);
    assert.equal(outdatedOptions.authorizations.find((p:{assetId:string})=>p.assetId===missionAsset.id).licenseCurrent,false);
    await call("/incidents/logistics",403,guard,"POST",missionBody);
    const renewedPermit=await call("/incidents/logistics/authorizations",200,sub,"PUT",{...permitBody,revision:3});
    assert.equal(renewedPermit.licenseId,missionLicense.id);assert.equal(renewedPermit.licenseRevision,2);
    // J04: editar la licencia sin cambiar numero ni clases conserva la habilitacion.
    await call(`/members/declarations/${missionLicense.id}`,200,staff,"PUT",{...missionLicenseData,revision:2,license:{...missionLicenseData.license,number:"TEST-MISSION-RENEWED",issuer:"Emisor ficticio actualizado"}});
    const keptPermit=(await call("/incidents/logistics/options",200,sub)).authorizations.find((p:{assetId:string})=>p.assetId===missionAsset.id);
    assert.equal(keptPermit.licenseCurrent,true);assert.equal(keptPermit.licenseRevision,3);
    assert((await call("/members/presence",200,staff)).needsConfirmation);
    const mission=await call("/incidents/logistics",201,guard,"POST",missionBody);
    const missionOverlap=await call("/fleet/water",409,guard,"POST",{...waterBody,operationKey:randomUUID(),assetId:alternateWaterAsset.id,departedAt:mission.departedAt,returnedAt:new Date().toISOString()});assert(missionOverlap.message.includes("personal"));
    const availabilityBoard=await call("/members/operational-availability",200,guard);
    assert.equal(availabilityBoard.people.find((p:{id:string})=>p.id===users[2]!.id).status,"DEPLOYED");
    assert(!(await call("/attendance/present",200,guard)).some((row:{user:{id:string}})=>row.user.id===users[2]!.id));
    await call("/incidents/logistics",409,sub,"POST",missionBody);
    assert.equal((await call("/members/presence",200,staff)).needsConfirmation,false);
    const closing={closingReport:"Cierre ficticio de intervencion con retorno confirmado"};
    await call(`/incidents/${incident.id}/close`,409,guard,"PATCH",closing);
    await call(`/incidents/logistics/${mission.id}/return`,409,guard,"POST",{});
    await call(`/incidents/logistics/${mission.id}/arrive`,200,guard,"POST",{});
    await call(`/incidents/logistics/${mission.id}/return`,200,guard,"POST",{});
    await call(`/incidents/logistics/${mission.id}/return`,200,guard,"POST",{});
    assert.equal(await prisma.vehicleDeparture.count({where:{assetId:missionAsset.id}}),1);
    const recalled=await call("/incidents/logistics",201,guard,"POST",missionBody);
    const recallPath=`/incidents/logistics/${recalled.id}/return-without-arrival`,recall={reason:"Central dispuso el regreso antes de llegar"};
    await call(recallPath,200,guard,"POST",{}); // G12: retorno sin llegada, sin motivo obligatorio
    await call(recallPath,200,guard,"POST",recall);
    assert.equal((await prisma.missionMovement.findUniqueOrThrow({where:{id:recalled.id}})).returnWithoutArrivalReason,"");
    await call(`/incidents/logistics/${recalled.id}/arrive`,409,guard,"POST",{});
    assert.equal((await prisma.missionMovement.findUniqueOrThrow({where:{id:recalled.id}})).arrivedAt,null);
    assert.equal(await prisma.vehicleDeparture.count({where:{assetId:missionAsset.id}}),2);
    const reportMonth=stationDate().slice(0,7);
    await call(`/operations/reports/operational?month=${reportMonth}`,403,staff);
    const operationalMetrics=await call(`/operations/reports/operational?month=${reportMonth}`,200,guard);
    assert(operationalMetrics.vehicles.some((row:{assetId:string;completed:number;withoutArrival:number})=>row.assetId===missionAsset.id&&row.completed===2&&row.withoutArrival===1));
    assert(operationalMetrics.departureToArrival.samples>=1);
    const resumed=await prisma.attendance.findFirstOrThrow({where:{userId:users[2]!.id,status:"OPEN"}});
    assert(resumed.presenceResumeAt);assert.equal(resumed.lastPresenceConfirmedAt,null);
    assert((await call("/attendance/present",200,guard)).some((row:{user:{id:string}})=>row.user.id===users[2]!.id));
    assert((await call(`/members/statistics/${users[2]!.id}`,200,staff)).attendedIncidents>=1);
    const qrCreatedIncident=await prisma.incident.create({data:{title:"Despacho QR de prueba",type:"OTHER",location:"Lugar ficticio",description:"Verificacion de despacho desde la planilla",createdByUserId:users[0]!.id}});
    const qrCreatedMovement=await call("/incidents/logistics",201,staff,"POST",{...missionBody,incidentId:qrCreatedIncident.id});
    assert.equal(qrCreatedMovement.createdByUserId,users[2]!.id);
    await call(`/incidents/logistics/${qrCreatedMovement.id}/arrive`,200,guard,"POST",{});
    await call(`/incidents/logistics/${qrCreatedMovement.id}/return`,200,guard,"POST",{});
    // G13: con los moviles retornados la intervencion se finaliza aunque falten datos de la planilla.
    await call(`/incidents/${qrCreatedIncident.id}/close`,200,guard,"PATCH",closing);
    const pendingSheet=await prisma.incidentSheet.findUniqueOrThrow({where:{incidentId:qrCreatedIncident.id}});
    assert(pendingSheet.finalizedAt);assert.equal((pendingSheet.finalContext as {dataPending:boolean}).dataPending,true);
    const sheetPath=`/incidents/${incident.id}/sheet`;
    const plan={revision:0,callerName:"Testigo de prueba",callerPhone:"+54 9 11 1234-5678",notes:"Intervención de prueba con dotación registrada",materials:[{name:"Linterna",quantity:1,notes:"Sin novedad"}],baseUserIds:[users[3]!.id],evidenceUrls:["https://example.invalid/evidencia"]};
    const technicalAdmin=await prisma.user.create({data:{username:"sheet_technical_admin",passwordHash,role:"ADMIN",profile:{create:{fullName:"Administrador de planillas",rank:"Administrador",dni:"SHEET-ADMIN",badge:"SHEET-ADMIN"}}}});
    const technicalToken=(await call("/auth/login",200,undefined,"POST",{username:technicalAdmin.username,password})).tokens.accessToken;
    const accessAlert=await prisma.alert.create({data:{type:"OTHER",priority:"LOW",location:"Escenario de permisos",description:"Alerta sintetica para verificar permisos de la planilla",createdByUserId:users[4]!.id}});
    await prisma.alertResponse.create({data:{alertId:accessAlert.id,userId:users[0]!.id,response:"NOT_GOING"}});
    const accessIncident=await prisma.incident.create({data:{title:"Planilla sin convocatoria ni QR",type:"OTHER",location:"Lugar sintetico",description:"Verificacion de lectura universal y edicion restringida",alertId:accessAlert.id,createdByUserId:users[4]!.id}});
    const accessPath=`/incidents/${accessIncident.id}/sheet`, accessPlan={...plan,baseUserIds:[]};
    assert.equal((await call(accessPath,200,guard)).canWrite,false);
    await call(accessPath,403,guard,"PUT",accessPlan);
    assert.equal((await call(accessPath,200,technicalToken)).canWrite,true);
    await call(accessPath,200,technicalToken,"PUT",accessPlan);
    assert.equal((await call(accessPath,200,admin)).canWrite,true);
    await call(accessPath,200,admin,"PUT",{...accessPlan,revision:1,notes:"Correccion por oficial que respondio No voy y no tiene QR"});
    assert.equal(await prisma.attendance.count({where:{userId:{in:[technicalAdmin.id,users[0]!.id]},status:"OPEN"}}),0);
    assert.equal((await prisma.alertResponse.findUniqueOrThrow({where:{alertId_userId:{alertId:accessAlert.id,userId:users[0]!.id}}})).response,"NOT_GOING");
    assert.equal((await prisma.incidentSheet.findUniqueOrThrow({where:{incidentId:accessIncident.id}})).authorId,technicalAdmin.id);
    assert.equal((await call(accessPath,200,guard)).sheet.revision,2);
    await call(accessPath,409,technicalToken,"PUT",accessPlan);
    const accessEntry={category:"NOTE",title:"Anotacion de participante con QR",body:"Se registra una novedad operativa de prueba",occurredAt:new Date(Date.now()-1000).toISOString()};
    const entry=await call(`/work/incidents/${accessIncident.id}/notebook`,201,staff,"POST",accessEntry);
    await call(`/work/incidents/${accessIncident.id}/notebook`,200,guard);
    await call(`/work/incidents/${accessIncident.id}/notebook/${entry.id}`,200,technicalToken,"PUT",{...accessEntry,revision:1,body:"Correccion administrativa de entrada ajena con historial"});
    await call(`/work/incidents/${accessIncident.id}/notebook`,403,guard,"POST",accessEntry);
    await call(`/incidents/${accessIncident.id}/close`,200,technicalToken,"PATCH",closing);
    assert.equal((await call(accessPath,200,guard)).canWrite,false);
    assert.equal((await call(accessPath,200,technicalToken)).canAddAnnex,true);
    await call(accessPath,409,technicalToken,"PUT",{...accessPlan,revision:3});
    await call(`/work/incidents/${accessIncident.id}/notebook`,201,technicalToken,"POST",accessEntry);
    const legacy=await prisma.incident.create({data:{title:"Historica sin planilla digital",type:"OTHER",location:"Base ficticia",description:"Historial consultable",status:"CLOSED",closedAt:new Date(),createdByUserId:technicalAdmin.id}});
    assert.equal((await call(`/incidents/${legacy.id}/sheet`,200,guard)).canWrite,false);
    assert.equal((await call(sheetPath,200,staff)).context.incident.movements.length,2);
    await call(sheetPath,403,guard,"PUT",plan);
    await call(sheetPath,400,staff,"PUT",{...plan,baseUserIds:[users[0]!.id]});
    const savedSheet=await call(sheetPath,200,staff,"PUT",plan);
    assert.equal(savedSheet.callerName,plan.callerName);assert.equal(savedSheet.callerPhone,plan.callerPhone);
    await call(sheetPath,409,staff,"PUT",plan);
    assert.equal((await call(sheetPath,200,minor,"GET")).canWrite,true);
    await call(`/incidents/${incident.id}/close`,200,guard,"PATCH",closing);
    const finalSheet=await call(sheetPath,200,guard);
    const amendment={revision:finalSheet.sheet.revision,reason:"Aclaración posterior documentada",correction:"Se aclara el material utilizado sin cambiar dotación ni horarios."};
    await call(sheetPath+"/amendments",403,staff,"POST",amendment);
    await call(sheetPath+"/amendments",403,guard,"POST",amendment);
    await call(sheetPath+"/amendments",201,admin,"POST",amendment);
    await call(sheetPath+"/amendments",409,admin,"POST",amendment);
    const amended=await call(sheetPath,200,guard);
    assert.equal(amended.amendments.length,1);
    assert.deepEqual(amended.context,finalSheet.context);
    assert.equal(amended.sheet.notes,finalSheet.sheet.notes);
    assert.equal((await call(sheetPath,200,staff)).canAddAnnex,true);
    const annex={category:"NOTE",title:"Detalle posterior",body:"Se agrega una novedad luego del cierre sin alterar la planilla.",occurredAt:new Date(Date.now()-1000).toISOString()};
    await call(`/work/incidents/${incident.id}/notebook`,403,guard,"POST",annex);
    const createdAnnex=await call(`/work/incidents/${incident.id}/notebook`,201,staff,"POST",annex);
    assert.equal((await call(sheetPath,200,staff)).notebookEntries.some((entry:{id:string})=>entry.id===createdAnnex.id),true);
    assert.equal(await prisma.auditLog.count({where:{entityType:"IncidentNotebookEntry",entityId:createdAnnex.id,action:"INCIDENT_POST_CLOSURE_ANNEX_CREATED"} }),1);
    assert(finalSheet.sheet.finalizedAt);assert.deepEqual(finalSheet.context.notCredited,[users[4]!.id]);
    // Quien dijo "Voy" y no figura en la planilla pierde la respuesta; queda la constancia en auditoria.
    assert.equal(await prisma.alertResponse.count({where:{alertId:alert.id,userId:users[4]!.id}}),0);
    assert.equal(await prisma.auditLog.count({where:{entityType:"Alert",entityId:alert.id,action:"ALERT_GOING_REMOVED_NO_SHOW"}}),1);
    assert.equal((await call(`/members/statistics/${users[4]!.id}`,200,guard)).attendedIncidents,0);
    await call(sheetPath,409,staff,"PUT",{...plan,revision:1});
    assert((await call(`/members/statistics/${users[3]!.id}`,200,minor)).attendedIncidents>=1);
    // G15: una intervencion cerrada se anula y rehace; la anterior deja de acreditar.
    const creditedBefore=(await call(`/members/statistics/${users[3]!.id}`,200,minor)).attendedIncidents;
    await call(`/incidents/${incident.id}/void-and-redo`,403,guard,"POST",{reason:"Horarios mal cargados en la planilla"});
    const redo=await call(`/incidents/${incident.id}/void-and-redo`,201,sub,"POST",{reason:"Horarios mal cargados en la planilla"});
    await call(`/incidents/${incident.id}/void-and-redo`,409,admin,"POST",{reason:"Segunda anulacion de la misma intervencion"});
    assert((await prisma.incident.findUniqueOrThrow({where:{id:incident.id}})).voidedAt);
    assert.equal((await prisma.incident.findUniqueOrThrow({where:{id:redo.incidentId}})).replacesIncidentId,incident.id);
    assert.equal(await prisma.vehicleDeparture.count({where:{voidedAt:null,mission:{incidentId:incident.id}}}),0);
    assert.equal((await call(`/members/statistics/${users[3]!.id}`,200,minor)).attendedIncidents,creditedBefore-1);
    const redoDeparted=new Date(Date.now()-3*3600000),redoReturned=new Date(Date.now()-2*3600000);
    const plainOpen=await prisma.incident.create({data:{title:"Intervencion comun abierta",type:"OTHER",location:"Lugar ficticio",description:"Sin reemplazo",createdByUserId:users[0]!.id}});
    await call("/incidents/logistics",400,guard,"POST",{...missionBody,incidentId:plainOpen.id,departedAt:redoDeparted.toISOString(),returnedAt:redoReturned.toISOString()});
    await prisma.incident.update({where:{id:redo.incidentId},data:{occurredAt:new Date(Date.now()-4*3600000)}});
    const reloaded=await call("/incidents/logistics",201,guard,"POST",{...missionBody,incidentId:redo.incidentId,departedAt:redoDeparted.toISOString(),returnedAt:redoReturned.toISOString()});
    const reloadedRow=await prisma.missionMovement.findUniqueOrThrow({where:{id:reloaded.id}});
    assert.equal(reloadedRow.returnedAt?.toISOString(),redoReturned.toISOString());assert(reloadedRow.departureId);
    await call("/incidents/logistics",409,guard,"POST",{...missionBody,incidentId:redo.incidentId,departedAt:new Date(+redoDeparted+600000).toISOString(),returnedAt:redoReturned.toISOString()});
    // M03: inasistencia a guardia sin presencia QR en el turno; idempotente y sin tocar la guardia.
    const { recordShiftAbsences, remindUnacknowledgedMessages } = await import("../modules/members/compliance-jobs");
    const missedDay=stationDate(new Date(Date.now()-2*86400000));
    const missedShift=await prisma.shift.create({data:{date:new Date(missedDay),period:"NIGHT",shiftType:"Guardia nocturna",startTime:"20:00",endTime:"08:00",createdByUserId:users[0]!.id,assignments:{create:[{userId:users[1]!.id}]}}});
    assert(await recordShiftAbsences()>=1);assert.equal(await recordShiftAbsences(),0);
    assert(await prisma.memberNotification.findUnique({where:{dedupeKey:`shift-absence:${missedShift.id}:${users[1]!.id}`}}));
    assert.equal(await prisma.shiftAssignment.count({where:{shiftId:missedShift.id}}),1);
    // N06: recordatorio unico a quien no confirmo lectura a las 24 horas.
    const oldMessage=await prisma.chatMessage.create({data:{authorUserId:users[0]!.id,body:"Instruccion importante de prueba",createdAt:new Date(Date.now()-26*3600000)}});
    await prisma.user.updateMany({where:{id:{in:users.map(u=>u.id)}},data:{createdAt:new Date(Date.now()-30*86400000)}});
    const ack=await call(`/members/messages/${oldMessage.id}/read`,200,staff);await call(`/members/messages/${oldMessage.id}/read`,200,staff,"POST",{contentHash:ack.contentHash});
    assert(await remindUnacknowledgedMessages()>=1);assert.equal(await remindUnacknowledgedMessages(),0);
    assert(!await prisma.memberNotification.findFirst({where:{userId:users[2]!.id,dedupeKey:{startsWith:`ack-reminder:${oldMessage.id}`}}}));
    assert(await prisma.memberNotification.findFirst({where:{userId:users[1]!.id,dedupeKey:{startsWith:`ack-reminder:${oldMessage.id}`}}}));
    // C06: la guardia ve contacto de emergencia solo con una emergencia activa.
    await prisma.alert.updateMany({where:{status:"ACTIVE"},data:{status:"RESOLVED"}});await prisma.incident.updateMany({where:{status:"OPEN"},data:{status:"CLOSED"}});
    await call(`/members/profile/${users[2]!.id}`,403,guard);
    const emergencyAlert=await prisma.alert.create({data:{type:"FIRE",priority:"HIGH",location:"Lugar ficticio",description:"Emergencia activa",createdByUserId:users[0]!.id}});
    const emergencyView=await call(`/members/profile/${users[2]!.id}`,200,guard);
    assert.equal(emergencyView.profile.dni,undefined);assert("emergencyContact" in emergencyView);
    await prisma.alert.update({where:{id:emergencyAlert.id},data:{status:"RESOLVED"}});
    // --- Cuenta de guardia propia: otro usuario y contraseña, separada de la cuenta personal ---
    await call("/auth/access-mode",410,staff,"POST",{mode:"GUARD"}); // la guardia ya no es un modo de la cuenta personal
    const guardPath=`/users/${users[2]!.id}/guard-account`, guardPassword=randomUUID()+"!Gg7";
    const guardInput={username:"guardia.prueba",password:guardPassword,reason:"Cuenta de guardia para la prueba de separación"};
    await call(guardPath,403,staff,"POST",guardInput);
    await call(`/users/${users[3]!.id}/guard-account`,400,admin,"POST",{...guardInput,username:"guardia.admin"});
    await call(guardPath,400,admin,"POST",{...guardInput,password:"corta"});
    const createdGuard=await call(guardPath,201,admin,"POST",guardInput);
    assert.equal(createdGuard.account.username,"guardia.prueba");assert.equal(createdGuard.account.mustChangePassword,true);
    await call(guardPath,409,admin,"POST",{...guardInput,username:"guardia.otra"});
    assert.equal((await call(guardPath,200,admin)).account.onDuty,false);
    await prisma.user.update({where:{id:createdGuard.account.id},data:{mustChangePassword:false}}); // en uso real la cambia al primer ingreso
    assert(await prisma.attendance.findFirst({where:{userId:users[2]!.id,status:"OPEN"}}),"La persona tiene una permanencia personal abierta");
    const guardLogin=await call("/auth/login",200,undefined,"POST",{username:"guardia.prueba",password:guardPassword});
    const guardAccount=guardLogin.tokens.accessToken;
    assert.equal(guardLogin.user.role,"GUARD");assert.equal(guardLogin.user.profile.rank,"Guardia");
    assert(!(await prisma.attendance.findFirst({where:{userId:users[2]!.id,status:"OPEN"}})),"Al entrar con la cuenta de guardia se cierra la permanencia personal");
    assert(await prisma.auditLog.findFirst({where:{action:"ATTENDANCE_CLOSED_FOR_GUARD",actorUserId:createdGuard.account.id}}));
    assert.equal((await call(guardPath,200,admin)).account.onDuty,true);
    await call("/users",403,guardAccount);await call("/audit-logs",403,guardAccount);
    const scanBody=(qrToken:string,deviceFingerprint:string)=>({qrToken,latitude:-33,longitude:-64,accuracy:5,deviceFingerprint});
    const ownGuardQr=await call("/attendance/qr-challenges",201,guardAccount,"POST",{stationId:station.id});
    await call("/attendance/scan",403,staff,"POST",scanBody(ownGuardQr.qrToken,"own-phone")); // el QR de su propia cuenta de guardia
    const otherQr=await call("/attendance/qr-challenges",201,guard,"POST",{stationId:station.id});
    await call("/attendance/scan",403,staff,"POST",scanBody(otherQr.qrToken,"own-phone")); // su cuenta de guardia sigue abierta
    await call("/attendance/scan",403,guardAccount,"POST",scanBody(otherQr.qrToken,"guard-tablet")); // la cuenta de guardia no ficha
    await call("/auth/logout",200,guardAccount,"POST");
    const back=await call("/attendance/scan",200,staff,"POST",scanBody(otherQr.qrToken,"own-phone")); // terminada la guardia, ficha como personal
    assert.equal(back.action,"CHECK_IN");
    // --- Base sin ubicación: se ficha solo con el QR ---
    await call("/attendance/scan",428,sub,"POST",{qrToken:otherQr.qrToken,deviceFingerprint:"sub-phone"}); // cuartel con ubicación: la pide
    const openBaseQr=await call("/attendance/qr-challenges",201,guard,"POST",{stationId:"base-sin-ubicacion"});
    const baseIn=await call("/attendance/scan",200,sub,"POST",{qrToken:openBaseQr.qrToken,deviceFingerprint:"sub-phone"});
    assert.equal(baseIn.action,"CHECK_IN");assert.equal(baseIn.distanceMeters,0);
    assert.equal((await call("/members/presence",200,sub)).needsConfirmation,false,"La base sin ubicación no pide confirmar presencia por GPS");
    assert.equal((await call("/attendance/scan",200,sub,"POST",{qrToken:openBaseQr.qrToken,deviceFingerprint:"sub-phone"})).action,"CHECK_OUT");
    const contextMessage=await call("/chat/messages",201,staff,"POST",{body:"Prueba de permisos de sesión"});
    await call(`/chat/messages/${contextMessage.id}/pin`,403,guard,"PATCH",{isPinned:true});
    await call(`/chat/messages/${contextMessage.id}`,403,guard,"DELETE",{});
    await call(`/chat/messages/${contextMessage.id}/pin`,200,sub,"PATCH",{isPinned:true});
    const streamAbort = new AbortController();
    const stream = await fetch(base + "/attendance/present/events", { headers: { Authorization: `Bearer ${staff}` }, signal: streamAbort.signal });
    assert.equal(stream.status, 200); assert(stream.body); paths++;
    const reader = stream.body.getReader();
    try {
      assert(new TextDecoder().decode((await reader.read()).value).includes("event: ready"));
      await call(`/users/${users[4]!.id}`, 200, admin, "PATCH", { isActive: true });
      let timer: ReturnType<typeof setTimeout> | undefined;
      try { const next = await Promise.race([reader.read(), new Promise<never>((_r, reject) => { timer = setTimeout(() => reject(new Error("No llego evento de presencia")), 3000); })]); assert(new TextDecoder().decode(next.value).includes("event: changed")); }
      finally { if (timer) clearTimeout(timer); }
    } finally { streamAbort.abort(); await reader.cancel().catch(() => {}); }
    const personal = await call(`/users/${users[3]!.id}`, 200, admin);
    await call(`/users/${users[3]!.id}`, 200, admin, "PATCH", { revision: personal.updatedAt, fullName: "Nombre corregido por administracion" });
    const current = await call(`/users/${users[3]!.id}`, 200, admin);
    await call(`/users/${users[3]!.id}`, 409, admin, "PATCH", { revision: personal.updatedAt, fullName: "No debe pisar la version actual" });
    assert.equal(current.profile.fullName, "Nombre corregido por administracion");
    await call(`/users/${users[3]!.id}`, 403, guard, "DELETE", { revision: current.updatedAt, reason: "Baja sin permiso de administracion" });
    await call(`/users/${users[3]!.id}`, 200, admin, "DELETE", { revision: current.updatedAt, reason: "Baja administrativa ficticia de prueba" });
    await call("/auth/me", 401, minor);
    assert(await prisma.user.findUniqueOrThrow({ where: { id: users[3]!.id } }).then((u) => u.deletedAt));
    assert.equal(await prisma.controlGroupMember.count({ where: { userId: users[3]!.id } }), 0);
    const resetUser = await call("/users", 201, admin, "POST", { username: "business_reset", password, fullName: "Prueba de recuperacion", dni: "RESET-123", badge: "RESET-123", rank: "Bombero", role: "FIREFIGHTER" });
    const pausedAttendance = await prisma.attendance.create({ data: { userId: resetUser.id, stationId: station.id, status: "OPEN", checkInAt: new Date(Date.now() - 60000) } });
    await call(`/users/${resetUser.id}`, 200, admin, "PATCH", { isActive: false });
    assert.equal((await prisma.attendance.findUniqueOrThrow({ where: { id: pausedAttendance.id } })).status, "CLOSED");
    await call("/auth/login", 401, undefined, "POST", { username: resetUser.username, password });
    await call(`/users/${resetUser.id}`, 200, admin, "PATCH", { isActive: true });
    const resetLogin = await call("/auth/login", 200, undefined, "POST", { username: resetUser.username, password });
    const resetBefore = await call(`/users/${resetUser.id}`, 200, admin);
    const resetResult = await call(`/users/${resetUser.id}/reset-password`, 200, admin, "POST", { revision: resetBefore.updatedAt, reason: "Recuperacion solicitada por titular" });
    await call("/auth/me", 401, resetLogin.tokens.accessToken);
    await call("/auth/login", 401, undefined, "POST", { username: resetUser.username, password });
    assert((await call("/auth/login", 200, undefined, "POST", { username: resetUser.username, password: resetResult.initialPassword })).user.mustChangePassword);
    await call(`/members/statistics/${users[2]!.id}/activity`, 403, guard);
    for (const kind of ["ATTENDANCE", "SHIFT", "INCIDENT", "INSPECTION", "WORK"]) {
      const history = await call(`/members/statistics/${users[2]!.id}/activity?kind=${kind}`, 200, staff);
      assert(Array.isArray(history.items)); assert(history.items.length <= 20);
    }
    assert(await prisma.auditLog.findFirst({ where: { action: "USER_UPDATED", entityId: users[3]!.id } }).then((a) => JSON.stringify(a?.metadata).includes("changes")));
    console.log(`Reglas de negocio: ${paths} caminos HTTP aprobados en esquema aislado.`);
  } finally {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    if (db) { const { flushRequestAudit } = await import("../middlewares/request-audit.middleware"); await flushRequestAudit(); await db.$disconnect(); }
    process.env.DATABASE_URL = original;
    if (!/^business_verify_[a-f0-9]{16}$/.test(schema)) throw new Error("Esquema temporal invalido");
    await root.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await root.$disconnect();
  }
}
main().catch((err) => { console.error(err); process.exitCode = 1; });
