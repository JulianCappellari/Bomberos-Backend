import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import bcrypt from "bcrypt";
import { isolatedApiTest } from "./isolated-api-test";
let app: typeof import("../app").app;
let prisma: typeof import("../config/prisma").prisma;
import { stationDate } from "../utils/station-time";
let reportBounds: typeof import("../modules/operations/reports.service").reportBounds;

async function main() {
  const runId = randomUUID().slice(0, 8);
  const password = randomUUID() + "!Aa7";
  const userIds: string[] = [];
  let assetId: string | undefined;
  let stationId: string | undefined;
  let groupId: string | undefined;
  let server: ReturnType<typeof app.listen> | undefined;
  let assertions = 0;
  try {
    const passwordHash = await bcrypt.hash(password, 10);
    for (const role of ["ADMIN", "FIREFIGHTER", "FIREFIGHTER", "GUARD"] as const) {
      const index = userIds.length;
      const user = await prisma.user.create({
        data: {
          username: `__operations_${runId}_${index}`, passwordHash, role,
          profile: { create: { fullName: `Personal temporal ${index}`, dni: `T${runId}${index}`, badge: `T${runId}${index}`, rank: role === "GUARD" ? "Guardia" : "Bombero" } },
        },
      });
      userIds.push(user.id);
    }
    const asset = await prisma.asset.create({
      data: {
        name: `Movil temporal ${runId}`, assetType: "VEHICLE", status: "OPERATIONAL",
        vehicle: { create: {
          unitNumber: `T-${runId}`,
          compartments: { create: { name: "Baulera temporal", items: { create: { name: "Material temporal", expectedQuantity: 1 } } } },
        } },
      },
      include: { vehicle: { include: { compartments: { include: { items: true } } } } },
    });
    assetId = asset.id;
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server!.once("listening", resolve));
    const address = server.address();
    assert(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}/api`;
    async function request(path: string, status: number, method = "GET", body?: unknown, token?: string): Promise<any> {
      // Los controles se finalizan desde un borrador iniciado con presencia QR.
      if (["/inspections", "/equipment/inspections"].includes(path) && method === "POST" && status === 201 && body && !(body as any).draftId) {
        const input = body as any;
        const draft = await request("/inspections/drafts", 201, "POST", { vehicleId: input.vehicleId }, token);
        await request(`/inspections/drafts/${draft.id}/participants`, 200, "PUT", { revision: draft.revision, userIds: input.responsibleUserIds }, token);
        body = { ...input, draftId: draft.id, inspectionDate: stationDate(new Date(draft.startedAt)), inspectionTime: new Intl.DateTimeFormat("en-GB", { timeZone: "America/Argentina/Buenos_Aires", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(draft.startedAt)) };
      }
      const response = await fetch(base + path, {
        method,
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const text = await response.text();
      assert(response.headers.get("content-type")?.includes("application/json"), `${method} ${path}: respuesta no JSON, estado ${response.status}`);
      const result = JSON.parse(text);
      assert.equal(response.status, status, `${method} ${path}: ${JSON.stringify(result)}`);
      assertions++;
      return result;
    }
    const tokens: string[] = [];
    for (let index = 0; index < userIds.length; index++) {
      const result = await request("/auth/login", 200, "POST", { username: `__operations_${runId}_${index}`, password });
      tokens.push(result.tokens.accessToken);
    }
    const [admin, staff, reader, duty] = tokens;
    const station = await prisma.station.create({ data: { name: `Cuartel temporal ${runId}`, latitude: 0, longitude: 0 } });
    stationId = station.id;
    const challenge = await prisma.qrChallenge.create({ data: { stationId, tokenHash: randomUUID(), expiresAt: new Date() } });
    await prisma.attendance.createMany({ data: [userIds[0],userIds[1]].map(userId => ({ userId, stationId: station.id, checkInQrId: challenge.id, checkInAt: new Date(Date.now() - 10 * 60000), status: "OPEN" as const, checkInTrust: "HIGH" as const })) });
    groupId = (await prisma.controlGroup.create({ data: { name: `Grupo temporal ${runId}`, startsOn: new Date(stationDate(new Date(Date.now() - 3 * 86400000))), repeatWeeks: 4, members: { create: [userIds[0], userIds[1]].map((userId) => ({ userId })) } } })).id;
    const future = new Date("2090-01-01T00:00:00Z");
    while (await prisma.shift.count({ where: { date: future } })) future.setUTCDate(future.getUTCDate() + 1);
    const date = future.toISOString().slice(0, 10);
    const availability = { date, period: "DAY", status: "UNAVAILABLE", notes: "Nota privada temporal", revision: 0 };
    await request(`/operations/availability?date=${date}`, 401);
    await request("/operations/availability", 200, "PUT", availability, staff);
    const publicRows = await request(`/operations/availability?date=${date}`, 200, "GET", undefined, reader);
    assert.equal(publicRows.find((row: any) => row.userId === userIds[1]).notes, null);
    const guard = { date, period: "DAY", assignedUserIds: [userIds[1]] };
    await request("/shifts", 409, "POST", guard, admin);
    await request("/operations/availability", 200, "PUT", { ...availability, status: "AVAILABLE", revision: 1 }, staff);
    const shift = await request("/shifts", 201, "POST", guard, admin);
    await request("/operations/availability", 409, "PUT", { ...availability, revision: 2 }, staff);
    await request("/operations/availability", 403, "PUT", { ...availability, userId: userIds[0], revision: 0 }, staff);

    const protocol = { kind: "PROTOCOL", title: `Protocolo temporal ${runId}`, category: "Pruebas", body: "Contenido temporal para verificar el flujo de publicacion." };
    await request("/operations/documents", 403, "POST", protocol, staff);
    await request("/operations/documents", 400, "POST", { ...protocol, externalUrl: "javascript:alert(1)" }, admin);
    const document = await request("/operations/documents", 201, "POST", protocol, admin);
    const draftsHidden = await request("/operations/documents?kind=PROTOCOL", 200, "GET", undefined, staff);
    assert.equal(draftsHidden.some((row: any) => row.id === document.id), false);
    await request("/operations/documents?status=DRAFT", 403, "GET", undefined, staff);
    const published = await request(`/operations/documents/${document.id}/status`, 200, "PATCH", { status: "PUBLISHED", revision: 1 }, admin);
    assert(published.publishedAt);
    await request(`/operations/documents/${document.id}`, 409, "PUT", { ...protocol, revision: 2 }, admin);
    const publishedRows = await request("/operations/documents?kind=PROTOCOL", 200, "GET", undefined, staff);
    assert(publishedRows.some((row: any) => row.id === document.id));

    const report = await request("/operations/documents", 201, "POST", { ...protocol, kind: "SHIFT_REPORT", title: "Acta temporal", shiftId: shift.id }, duty);
    const finalReport = await request(`/operations/documents/${report.id}/status`, 200, "PATCH", { status: "PUBLISHED", revision: 1 }, duty);
    assert.equal(finalReport.publicationContext.shift.assignments[0].user.id, userIds[1]);
    assert.equal("passwordHash" in finalReport.publicationContext.shift.assignments[0].user, false);
    await request(`/shifts/${shift.id}`, 200, "PUT", { ...guard, assignedUserIds: [userIds[2]] }, admin);
    const persistedReport = await prisma.operationalDocument.findUniqueOrThrow({ where: { id: report.id } });
    assert.equal((persistedReport.publicationContext as any).shift.assignments[0].user.id, userIds[1]);
    await request(`/shifts/${shift.id}`, 409, "DELETE", undefined, admin);
    const incident = await request("/incidents", 201, "POST", {
      title: "Intervencion temporal", type: "OTHER", description: "Descripcion temporal de una intervencion de prueba",
      location: "Ubicacion temporal", assignedUserIds: [userIds[1]],
    }, admin);
    const incidentReport = await request("/operations/documents", 201, "POST", {
      ...protocol, title: "Acta de intervencion temporal", kind: "INCIDENT_REPORT", incidentId: incident.id,
    }, admin);
    const finalIncidentReport = await request(`/operations/documents/${incidentReport.id}/status`, 200, "PATCH", { status: "PUBLISHED", revision: 1 }, admin);
    assert.equal(finalIncidentReport.publicationContext.incident.id, incident.id);

    const work = { assetId, title: "Reparacion temporal", description: "Trabajo bloqueante para verificar el estado del movil", publishTask: false, blocksOperation: true };
    await request("/operations/maintenance", 403, "POST", work, staff);
    const job = await request("/operations/maintenance", 201, "POST", work, admin);
    assert.equal((await prisma.asset.findUniqueOrThrow({ where: { id: assetId } })).status, "MAINTENANCE");
    await request(`/assets/${assetId}`, 403, "PUT", { status: "OPERATIONAL" }, staff);
    await request(`/assets/${assetId}`, 400, "PUT", { status: "OPERATIONAL" }, admin);
    const control = {
      vehicleId: asset.vehicle!.id, inspectionDate: stationDate(new Date(Date.now() - 120000)), inspectionTime: new Intl.DateTimeFormat("en-GB", { timeZone: "America/Argentina/Buenos_Aires", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(Date.now() - 120000)),
      leaderUserId: userIds[1], responsibleUserIds: [userIds[0], userIds[1]],
      items: [{ inventoryItemId: asset.vehicle!.compartments[0].items[0].id, result: "OK", observedQuantity: 1 }],
    };
    const blockedControl = await request("/inspections", 201, "POST", control, admin);
    assert.equal(blockedControl.resultingAssetStatus, "MAINTENANCE");
    await request("/equipment/inspections", 400, "POST", { vehicleId: asset.vehicle!.id, items: control.items }, admin);
    const alternateControl = await request("/equipment/inspections", 201, "POST", control, admin);
    assert.equal(alternateControl.resultingAssetStatus, "MAINTENANCE");
    assert.equal("passwordHash" in alternateControl.responsibles[0].user, false);
    await request(`/operations/maintenance/${job.id}/status`, 400, "PATCH", { status: "RESOLVED", revision: 1 }, admin);
    await request(`/operations/maintenance/${job.id}/status`, 200, "PATCH", {
      status: "RESOLVED", revision: 1, resolution: "Reparacion realizada y verificada por responsable", costCents: 5000,
    }, admin);
    assert.equal((await prisma.asset.findUniqueOrThrow({ where: { id: assetId } })).status, "MAINTENANCE");
    // El ayudante inicia un borrador nuevo despues de la reparacion: no es un control historico.
    const afterRepair = await request("/inspections", 201, "POST", control, admin);
    assert.equal(afterRepair.resultingAssetStatus, "OPERATIONAL");
    const localTime = new Intl.DateTimeFormat("en-GB", {
      timeZone: "America/Argentina/Buenos_Aires", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).format(new Date());
    const repairedControl = await request("/inspections", 201, "POST", {
      ...control, inspectionDate: stationDate(), inspectionTime: localTime,
    }, admin);
    assert.equal(repairedControl.resultingAssetStatus, "OPERATIONAL");
    await request(`/operations/maintenance/${job.id}/status`, 409, "PATCH", { status: "IN_PROGRESS", revision: 2 }, admin);
    await request(`/operations/maintenance?assetId=${assetId}`, 403, "GET", undefined, staff);
    const readerJobs = await request(`/operations/maintenance?assetId=${assetId}`, 200, "GET", undefined, duty);
    assert.equal(readerJobs[0].costCents, 5000);
    await request(`/operations/documents/${document.id}/status`, 200, "PATCH", { status: "ARCHIVED", revision: 2 }, admin);
    const bounds = reportBounds("2020-02");
    await prisma.attendance.createMany({
      data: [
        { userId: userIds[1], stationId, status: "CLOSED", checkInAt: new Date(bounds.start.getTime() - 3600000), checkOutAt: new Date(bounds.start.getTime() + 3600000) },
        { userId: userIds[1], stationId, status: "CLOSED", checkInAt: new Date(bounds.start.getTime() - 3600000), checkOutAt: new Date(bounds.start.getTime() + 3600000) },
        { userId: userIds[2], stationId, status: "CLOSED", checkInAt: bounds.start, checkOutAt: new Date(bounds.start.getTime() + 7200000) },
      ],
    });
    await request("/operations/reports/monthly?month=2020-02", 401);
    await request("/operations/reports/monthly?month=2020-99", 400, "GET", undefined, admin);
    const ownReport = await request("/operations/reports/monthly?month=2020-02", 200, "GET", undefined, staff);
    assert.equal(ownReport.scope, "SELF");
    assert.equal(ownReport.people.length, 1);
    assert.equal(ownReport.people[0].user.id, userIds[1]);
    assert.equal(ownReport.people[0].workedMinutes, 60);
    const fullReport = await request("/operations/reports/monthly?month=2020-02", 200, "GET", undefined, admin);
    assert.equal(fullReport.scope, "ALL");
    assert.equal(fullReport.people.find((row: any) => row.user.id === userIds[2]).workedMinutes, 120);
    console.log(JSON.stringify({ result: "OK", apiPaths: assertions, features: ["availability", "shift conflicts", "maintenance", "vehicle controls", "protocols", "guard reports", "incident reports", "permissions", "immutable publication", "monthly reports", "overlapping attendance"] }));
  } finally {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    const { flushRequestAudit } = await import("../middlewares/request-audit.middleware"); await flushRequestAudit();
    if (userIds.length) {
      await prisma.$transaction([
        prisma.$executeRaw`SELECT set_config('bomberos.audit_purge', 'on', true)`,
        prisma.auditLog.deleteMany({ where: { actorUserId: { in: userIds } } }),
        prisma.memberNotification.deleteMany({ where: { userId: { in: userIds } } }),
        prisma.controlGroupMember.deleteMany({ where: { groupId: groupId || "__no_group__" } }),
        prisma.controlGroup.deleteMany({ where: { id: groupId || "__no_group__" } }),
        prisma.operationalDocument.deleteMany({ where: { createdByUserId: { in: userIds } } }),
        prisma.personnelAvailability.deleteMany({ where: { userId: { in: userIds } } }),
        prisma.maintenanceJob.deleteMany({ where: { createdByUserId: { in: userIds } } }),
        prisma.incident.deleteMany({ where: { createdByUserId: { in: userIds } } }),
        prisma.shift.deleteMany({ where: { createdByUserId: { in: userIds } } }),
        prisma.inspection.deleteMany({ where: { createdByUserId: { in: userIds } } }),
        prisma.controlDraft.deleteMany({ where: { ownerId: { in: userIds } } }),
        prisma.asset.deleteMany({ where: { id: assetId || "__no_test_asset__" } }),
        prisma.attendance.deleteMany({ where: { userId: { in: userIds } } }),
        prisma.qrChallenge.deleteMany({ where: { stationId: stationId || "__no_test_station__" } }),
        prisma.station.deleteMany({ where: { id: stationId || "__no_test_station__" } }),
        prisma.user.deleteMany({ where: { id: { in: userIds } } }),
      ]);
    }
    await prisma.$disconnect();
  }
}
isolatedApiTest(async () => { app = (await import("../app")).app; prisma = (await import("../config/prisma")).prisma; reportBounds = (await import("../modules/operations/reports.service")).reportBounds; await main(); }).catch((error) => { console.error(error); process.exitCode = 1; });
