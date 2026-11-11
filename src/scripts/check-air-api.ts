import { purgeAuditLogs } from "../utils/audit-purge";
import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import bcrypt from "bcrypt";
import { isolatedApiTest } from "./isolated-api-test";
let app: typeof import("../app").app;
let prisma: typeof import("../config/prisma").prisma;
import { stationDate } from "../utils/station-time";

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("No ejecutar pruebas de datos temporales en produccion");
  const run = randomUUID().slice(0, 8), users: string[] = [], cylinders: string[] = [], comps: string[] = [], assets: string[] = [], jobs: string[] = [];
  const password = randomUUID() + "!Aa7", server = app.listen(0, "127.0.0.1"); let paths = 0;
  try {
    await new Promise<void>((resolve) => server.once("listening", resolve)); const address = server.address(); assert(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}/api`;
    const hash = await bcrypt.hash(password, 10);
    for (const [index, role] of (["ADMIN", "OPERATOR", "FIREFIGHTER"] as const).entries()) users.push((await prisma.user.create({ data: { username: `__air_${run}_${index}`, passwordHash: hash, role } })).id);
    async function request(path: string, expected: number, method = "GET", body?: unknown, token?: string) {
      const response = await fetch(base + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
      const data = await response.json(); assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(data)}`); assert(!JSON.stringify(data).includes("passwordHash")); paths++; return data;
    }
    const tokens: string[] = [];
    for (let index = 0; index < users.length; index++) tokens.push((await request("/auth/login", 200, "POST", { username: `__air_${run}_${index}`, password })).tokens.accessToken);
    const [admin, operator, staff] = tokens, root = "/air";
    const today = stationDate(), yesterday = new Date(today + "T00:00:00Z"); yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const future = new Date(today + "T00:00:00Z"); future.setUTCDate(future.getUTCDate() + 30); const until = future.toISOString().slice(0, 10);
    await request(`${root}/cylinders`, 401);
    const compInput = { code: `C-${run}`, name: "Compresor temporal", maxPressureBar: 300, filterLifeMinutes: 2, filterReference: "Manual ficticio de prueba", filterInstalledAt: yesterday.toISOString(), initialTotalMinutes: 60, initialFilterUsedMinutes: 0 };
    await request(`${root}/compressors`, 403, "POST", compInput, staff);
    const comp = await request(`${root}/compressors`, 201, "POST", compInput, admin); comps.push(comp.id); assets.push(comp.assetId);
    await request(`${root}/compressors`, 409, "POST", compInput, admin);
    const compPath = `${root}/compressors/${comp.id}`;
    async function getComp() { return (await request(`${root}/compressors?q=${run}`, 200, "GET", undefined, admin)).items.find((r: { id: string }) => r.id === comp.id); }
    let c = await getComp(); assert(c.blockingReasons.length > 0); assert.equal(c.remainingFilterMinutes, 2);
    await request(`${compPath}/status`, 400, "POST", { revision: c.revision, status: "OPERATIONAL", notes: "Falta registro de calidad de aire" }, admin);
    await request(`${compPath}/status`, 400, "POST", { revision: c.revision, status: "OPERATIONAL", notes: "Un registro vencido no habilita aire", airQualityReference: "CALIDAD-VENCIDA", airQualityValidUntil: yesterday.toISOString().slice(0, 10) }, admin);
    await request(`${compPath}/status`, 200, "POST", { revision: c.revision, status: "OPERATIONAL", notes: "Revision y control de calidad ficticios", airQualityReference: "CALIDAD-TEST", airQualityValidUntil: until }, operator);
    const tubeInput = { code: `T-${run}`, name: "Cilindro temporal", serialNumber: `SERIE-${run}`, ratedPressureBar: 300 };
    await request(`${root}/cylinders`, 403, "POST", tubeInput, staff);
    const tube = await request(`${root}/cylinders`, 201, "POST", tubeInput, admin); cylinders.push(tube.id); assets.push(tube.assetId);
    const tubePath = `${root}/cylinders/${tube.id}`;
    async function getTube() { return (await request(`${root}/cylinders?q=${run}`, 200, "GET", undefined, admin)).items.find((r: { id: string }) => r.id === tube.id); }
    let t = await getTube(); assert.equal(t.pressureBar, null);
    await request(`${tubePath}/status`, 409, "POST", { revision: t.revision, status: "OPERATIONAL", notes: "No puede operar sin prueba hidraulica" }, admin);
    const hydro = { revision: t.revision, result: "PASS", testedOn: today, validUntil: until, certificateReference: `H-${run}-1`, notes: "Prueba documentada ficticia de prueba" };
    // Q04: solo el responsable tecnico designado valida pruebas hidraulicas.
    await request(`${tubePath}/tests`, 403, "POST", hydro, admin);
    await prisma.user.updateMany({ where: { id: { in: [users[0]!, users[1]!] } }, data: { specialPermissions: ["TECHNICAL"] } });
    await request(`${tubePath}/tests`, 400, "POST", { ...hydro, validUntil: null }, admin);
    await request(`${tubePath}/tests`, 400, "POST", { ...hydro, testedOn: until }, admin);
    await request(`${tubePath}/tests`, 201, "POST", hydro, operator);
    t = await getTube(); assert.equal(t.asset.status, "MAINTENANCE");
    await request(`${tubePath}/tests`, 409, "POST", { ...hydro, revision: t.revision }, admin);
    await request(`${tubePath}/status`, 200, "POST", { revision: t.revision, status: "OPERATIONAL", notes: "Inspeccion de prueba sin novedades" }, operator);
    t = await getTube();
    await request(`${tubePath}/pressure`, 200, "POST", { revision: t.revision, pressureBar: 0, notes: "Medicion de prueba de cilindro vacio" }, operator);
    t = await getTube();
    await request(`${tubePath}/pressure`, 400, "POST", { revision: t.revision, pressureBar: 301, notes: "No admitir mediciones sobre limite" }, operator);
    await assert.rejects(() => prisma.airCylinder.update({ where: { id: tube.id }, data: { pressureBar: 301 } }), (error: unknown) => (error as Error).message.includes("AirCylinder_pressure_valid")); paths++;
    const vehicle = await prisma.asset.create({ data: { name: "Vehiculo temporal ERA", assetType: "VEHICLE" } }); assets.push(vehicle.id);
    await request(`${tubePath}/location`, 400, "POST", { revision: t.revision, vehicleAssetId: comp.assetId, notes: "Un compresor no es un movil valido" }, operator);
    await request(`${tubePath}/location`, 200, "POST", { revision: t.revision, vehicleAssetId: vehicle.id, notes: "Traslado ficticio al movil de prueba" }, operator);
    await request(`/assets/${vehicle.id}`, 400, "DELETE", undefined, admin);
    await request(`/assets/${tube.assetId}`, 400, "PUT", { status: "OPERATIONAL" }, admin);
    await request(`/assets/${comp.assetId}`, 400, "DELETE", undefined, admin);
    async function payload() {
      c = await getComp(); t = await getTube(); const startedAt = new Date().toISOString(); await new Promise((resolve) => setTimeout(resolve, 10));
      return { operationKey: randomUUID(), compressorId: c.id, revision: c.revision, startedAt, endedAt: new Date().toISOString(), operatorUserId: users[1], helperUserIds: [users[2]], reason: "TRAINING", notes: "Carga ficticia para probar la transaccion", items: [{ cylinderId: t.id, revision: t.revision, pressureBar: 200 }] };
    }
    let body = await payload();
    await request(`${root}/fills`, 403, "POST", body, staff);
    await request(`${root}/fills`, 400, "POST", { ...body, items: [...body.items, ...body.items] }, admin);
    await request(`${root}/fills`, 400, "POST", { ...body, helperUserIds: [users[1]] }, admin);
    await request(`${root}/fills`, 400, "POST", { ...body, endedAt: future.toISOString() }, admin);
    await request(`${root}/fills`, 400, "POST", { ...body, items: [{ ...body.items[0], pressureBar: 301 }] }, admin);
    await request(`${root}/fills`, 400, "POST", { ...body, helperUserIds: ["missing-user"] }, admin);
    await request(`${root}/fills`, 409, "POST", { ...body, revision: 1 }, admin);
    const first = await request(`${root}/fills`, 201, "POST", body, admin);
    assert.equal(first.runMinutes, 1); assert.equal(first.items[0].cylinderSnapshot.ratedPressureBar, 300);
    const repeated = await request(`${root}/fills`, 201, "POST", body, admin); assert.equal(repeated.id, first.id);
    await request(`${root}/fills`, 409, "POST", { ...body, notes: "La misma clave no puede cambiar sus datos" }, admin);
    await request(`${root}/fills`, 409, "POST", body, operator);
    c = await getComp(); assert.equal(c.totalRunMinutes, 61); assert.equal(c.remainingFilterMinutes, 1);
    const overlap = await payload(); await request(`${root}/fills`, 409, "POST", { ...overlap, startedAt: body.startedAt }, admin);
    const job = await request("/operations/maintenance", 201, "POST", { assetId: tube.assetId, title: "Mantenimiento de prueba ERA", description: "Trabajo ficticio bloqueante del cilindro", publishTask: false, blocksOperation: true }, admin); jobs.push(job.id);
    await request(`${root}/fills`, 409, "POST", await payload(), admin);
    await request(`/operations/maintenance/${job.id}/status`, 200, "PATCH", { revision: job.revision, status: "RESOLVED", resolution: "Trabajo temporal completado en prueba" }, admin);
    await request(`${root}/fills`, 409, "POST", await payload(), admin);
    t = await getTube(); await request(`${tubePath}/status`, 200, "POST", { revision: t.revision, status: "OPERATIONAL", notes: "Revision posterior a la reparacion" }, operator);
    body = await payload();
    const racing = await Promise.all([0, 1].map(async () => {
      const response = await fetch(base + `${root}/fills`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${admin}` }, body: JSON.stringify({ ...body, operationKey: randomUUID() }) }); return response.status;
    })); assert.deepEqual(racing.sort(), [201, 409]); paths += 2;
    c = await getComp(); assert.equal(c.totalRunMinutes, 62); assert.equal(c.remainingFilterMinutes, 0);
    await request(`${root}/fills`, 409, "POST", await payload(), admin);
    await request(`${compPath}/filters`, 201, "POST", { revision: c.revision, filterLifeMinutes: 5, filterReference: "FILTRO-NUEVO-TEST", notes: "Recambio ficticio registrado en prueba" }, operator);
    await request(`${compPath}/filters`, 409, "POST", { revision: c.revision, filterLifeMinutes: 5, filterReference: "DUPLICADO-TEST", notes: "No debe duplicar el recambio del filtro" }, admin);
    c = await getComp(); assert.equal(c.totalRunMinutes, 62); assert.equal(c.filterBaselineMinutes, 62); assert.equal(c.asset.status, "MAINTENANCE"); assert.equal(c.airQualityReference, null);
    await request(`${root}/fills`, 409, "POST", await payload(), admin);
    await request(`${compPath}/status`, 200, "POST", { revision: c.revision, status: "OPERATIONAL", notes: "Revision posterior al recambio de filtro", airQualityReference: "CALIDAD-POST-FILTRO", airQualityValidUntil: until }, operator);
    t = await getTube();
    await request(`${tubePath}/tests`, 201, "POST", { ...hydro, revision: t.revision, result: "FAIL", validUntil: null, certificateReference: `H-${run}-2` }, admin);
    t = await getTube(); assert.equal(t.asset.status, "OUT_OF_SERVICE"); assert.equal(t.pressureBar, 200);
    await request(`${root}/fills`, 409, "POST", await payload(), admin);
    await request(`${tubePath}/tests`, 201, "POST", { ...hydro, revision: t.revision, certificateReference: `H-${run}-3` }, operator);
    t = await getTube(); assert.equal(t.asset.status, "OUT_OF_SERVICE");
    await request(`${tubePath}/status`, 200, "POST", { revision: t.revision, status: "OPERATIONAL", notes: "Nueva revision favorable tras prueba" }, operator);
    t = await getTube(); await request(`${tubePath}/retire`, 200, "POST", { revision: t.revision, notes: "Baja de prueba para conservar historial" }, admin);
    await request(`${tubePath}/status`, 409, "POST", { revision: t.revision + 1, status: "OPERATIONAL", notes: "No puede rehabilitar un cilindro dado de baja" }, admin);
    await request(`${root}/fills?compressorId=${comp.id}`, 403, "GET", undefined, staff);
    await request(`${tubePath}/tests`, 403, "GET", undefined, staff);
    await request(`${compPath}/filters`, 403, "GET", undefined, staff);
    const history = await request(`${root}/fills?compressorId=${comp.id}`, 200, "GET", undefined, operator); assert.equal(history.total, 2);
    assert.equal((await request(`${tubePath}/tests`, 200, "GET", undefined, operator)).total, 3);
    assert.equal((await request(`${compPath}/filters`, 200, "GET", undefined, operator)).total, 1);
    const expired = await request(`${root}/cylinders`, 201, "POST", { ...tubeInput, code: `T-${run}-EXP`, serialNumber: `SERIE-${run}-EXP` }, admin); cylinders.push(expired.id); assets.push(expired.assetId);
    await request(`${root}/cylinders/${expired.id}/tests`, 201, "POST", { ...hydro, revision: 1, testedOn: yesterday.toISOString().slice(0, 10), validUntil: yesterday.toISOString().slice(0, 10), certificateReference: `H-${run}-EXP` }, admin);
    await request(`${root}/cylinders/${expired.id}/status`, 409, "POST", { revision: 2, status: "OPERATIONAL", notes: "No debe habilitar una prueba vencida" }, admin);
    await request(`${root}/fills/${first.id}`, 404, "DELETE", undefined, admin);
    await request(`${root}/cylinders?page=-1`, 400, "GET", undefined, admin);
    console.log(`ERA API OK: ${paths} caminos; presion, vigencias, idempotencia, concurrencia, mantenimiento y filtros.`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    const { flushRequestAudit } = await import("../middlewares/request-audit.middleware"); await flushRequestAudit();
    const fillIds = (await prisma.airFill.findMany({ where: { compressorId: { in: comps } }, select: { id: true } })).map((row) => row.id);
    await prisma.airFillHelper.deleteMany({ where: { fillId: { in: fillIds } } });
    await prisma.airFillItem.deleteMany({ where: { fillId: { in: fillIds } } });
    await prisma.airFill.deleteMany({ where: { id: { in: fillIds } } });
    await prisma.airHydroTest.deleteMany({ where: { cylinderId: { in: cylinders } } });
    await prisma.airFilterChange.deleteMany({ where: { compressorId: { in: comps } } });
    await prisma.airCylinder.deleteMany({ where: { id: { in: cylinders } } });
    await prisma.airCompressor.deleteMany({ where: { id: { in: comps } } });
    await prisma.maintenanceJob.deleteMany({ where: { id: { in: jobs } } });
    await prisma.asset.deleteMany({ where: { id: { in: assets } } });
    await purgeAuditLogs(prisma, { actorUserId: { in: users } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.$disconnect();
  }
}
isolatedApiTest(async () => { app = (await import("../app")).app; prisma = (await import("../config/prisma")).prisma; await main(); }).catch((error) => { console.error(error); process.exitCode = 1; });
