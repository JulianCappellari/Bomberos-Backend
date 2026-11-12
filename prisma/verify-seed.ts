import { purgeAuditLogs } from "../src/utils/audit-purge";
import "dotenv/config";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { Prisma, PrismaClient } from "@prisma/client";
import { seedDemo } from "./demo-data";
import { isAllowedFirefighterRank } from "../src/utils/firefighter-ranks";
import { repairDemoBusiness } from "./repair-demo-business";
import { verifySeedScenarios } from "./verify-seed-scenarios";
import { verifyProfessionalSeed } from "./verify-professional-seed";
import bcrypt from "bcrypt";
import { DEMO_PASSWORD, DEMO_LOGIN_KEYS } from "./demo-credentials";

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("La verificacion del seed no se ejecuta en produccion");
  const url = new URL(process.env.DATABASE_URL!);
  const schema = `bomberos_demo_verify_${randomBytes(8).toString("hex")}`;
  url.searchParams.set("schema", schema);
  const databaseUrl = url.toString();
  const client = new PrismaClient({ datasourceUrl: databaseUrl });
  const root = new PrismaClient();
  try {
    execFileSync(process.execPath, [require.resolve("prisma/build/index.js"), "migrate", "deploy"], { env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: "pipe" });
    const password = randomBytes(18).toString("base64url");
    const result = await seedDemo(client, password); console.log(result);
    async function counts() {
      const delegates = client as unknown as Record<string, { count(): Promise<number> }>;
      return Object.fromEntries(await Promise.all(Prisma.dmmf.datamodel.models.map(async ({ name }) => [name, await delegates[name[0]!.toLowerCase() + name.slice(1)]!.count()])));
    }
    const before = await counts();
    console.log(`Registros totales: ${Object.values(before).reduce<number>((sum, n) => sum + Number(n), 0)}`);
    await verifySeedScenarios(client);
    await verifyProfessionalSeed(client);
    await client.workTask.update({ where: { id: "demo_v2_professional_task_transfer_ACCEPTED" }, data: { title: "[DEMO] Titulo editado durante la prueba: conservar" } });
    await client.expenseClaim.update({ where: { id: "demo_v2_professional_expense_paid" }, data: { notes: "Nota editada al probar; el seed no debe sobrescribirla" } });
    const original = await client.user.findUniqueOrThrow({ where: { id: "demo_v2_admin" } });
    await client.user.update({ where: { id: original.id }, data: { passwordHash: "preserved-changed-password-hash" } });
    const edited = await client.user.update({ where: { username: "demo.clave_inicial" }, data: { isActive: false, role: "OPERATOR", profile: { update: { fullName: "[DEMO] Nombre editado que debe conservarse" } } }, include: { profile: true } });
    await seedDemo(client, password);
    assert.deepEqual(await counts(), before, "El seed repetido no debe duplicar ningun modelo");
    assert.equal((await client.workTask.findUniqueOrThrow({ where: { id: "demo_v2_professional_task_transfer_ACCEPTED" } })).title, "[DEMO] Titulo editado durante la prueba: conservar");
    assert.equal((await client.expenseClaim.findUniqueOrThrow({ where: { id: "demo_v2_professional_expense_paid" } })).notes, "Nota editada al probar; el seed no debe sobrescribirla");
    const preserved = await client.user.findUniqueOrThrow({ where: { id: edited.id }, include: { profile: true } });
    assert.equal(preserved.isActive, false); assert.equal(preserved.role, "OPERATOR"); assert.equal(preserved.profile?.fullName, edited.profile?.fullName);
    const cliOutput = execFileSync(process.execPath, [require.resolve("tsx/cli"), "prisma/seed-demo.ts"], { env: { ...process.env, NODE_ENV: "development", SEED_SCHEMA: schema, SEED_PASSWORD: password }, stdio: "pipe" }).toString();
    assert(cliOutput.includes("No se crearon cuentas nuevas"));
    assert(!cliOutput.includes("Clave inicial SOLO"));
    assert.deepEqual(await counts(), before, "El lanzador tampoco debe duplicar datos");
    assert.equal((await client.user.findUniqueOrThrow({ where: { id: original.id } })).passwordHash, "preserved-changed-password-hash");
    assert.throws(() => execFileSync(process.execPath, [require.resolve("tsx/cli"), "prisma/seed-demo.ts"], { env: { ...process.env, NODE_ENV: "development", SEED_SCHEMA: "public" }, stdio: "pipe" }), /SEED_SCHEMA/);
    assert.equal(await client.user.count(), 20);
    // Funciones nuevas: guardia propia, licencias por clase y moviles, deposito, encuestas, fotos y comision.
    assert.equal((await client.user.findUniqueOrThrow({ where: { username: "demo.guardia_bombero" } })).guardForUserId, "demo_v2_bombero");
    assert.equal((await client.vehicle.findUniqueOrThrow({ where: { id: "demo_v2_vehicle_0" } })).licenseCategory, "HEAVY");
    // Una licencia por clase (cada clase tiene su numero) y habilitacion de jefatura por movil.
    const bomberoLicenses = await client.personalDeclaration.findMany({ where: { userId: "demo_v2_bombero", category: "DRIVER_LICENSE", deletedAt: null } });
    assert(bomberoLicenses.every((l) => l.licenseClasses.length === 1), "Cada licencia es de una sola clase");
    for (const code of ["B.1", "C.1", "C.2", "D.4"]) assert(bomberoLicenses.some((l) => l.licenseClasses[0] === code), `Licencia ${code}`);
    assert.equal(new Set(bomberoLicenses.map((l) => l.licenseClasses[0])).size, bomberoLicenses.length, "Sin clases repetidas");
    for (const status of ["PENDING", "APPROVED", "REJECTED"]) assert(await client.vehicleDriverAuthorization.count({ where: { status } }), `Habilitación ${status}`);
    assert.equal((await client.vehicleDriverAuthorization.findUniqueOrThrow({ where: { assetId_userId: { assetId: "demo_v2_asset_0", userId: "demo_v2_bombero" } } })).status, "APPROVED");
    assert(await client.supplyItem.count({ where: { quantity: 0 } }) >= 1, "Hay un faltante sin stock");
    for (const status of ["PENDING", "APPROVED", "ORDERED", "DELIVERED", "REJECTED", "CANCELLED"]) assert(await client.materialRequest.count({ where: { status } }), `Pedido ${status}`);
    for (const item of await client.supplyItem.findMany({ include: { movements: { orderBy: { createdAt: "desc" }, take: 1 } } })) assert.equal(item.quantity, item.movements[0]?.balanceAfter ?? item.quantity, `Stock coherente: ${item.name}`);
    assert.equal(await client.chatPoll.count({ where: { closedAt: { not: null } } }), 1);
    assert.equal(await client.chatAttachment.count(), 1);
    assert(await client.station.findUnique({ where: { id: "base-sin-ubicacion" } }), "La migracion crea la base sin ubicacion");
    assert.equal(await client.incidentSheet.count({ where: { addressNumber: "" } }), 0, "Todas las planillas tienen los datos de la constancia");
    assert.equal(await client.incident.count({ where: { requestNumber: null } }), 0, "Todas las intervenciones tienen numero de pedido de auxilio");
    assert.equal((await client.user.findUniqueOrThrow({ where: { username: "demo.guardia" } })).role, "GUARD");
    for (const profile of await client.firefighterProfile.findMany()) assert(isAllowedFirefighterRank(profile.rank), `Cargo de demo invalido: ${profile.rank}`);
    assert.equal(await client.vehicle.count(), result.vehicles);
    assert(await client.inspectionItem.count() > await client.vehicleInventoryItem.count() + result.vehicles * 3);
    assert.equal(await client.controlGroup.count(), 2);
    assert.equal((await client.personalDeclaration.findUniqueOrThrow({ where: { id: "demo_v2_personal_clothing" } })).clothingSize, "L");
    assert.equal(await client.airCylinder.count(), 8); // 7 del inventario ERA + 1 de reserva con poca carga (novedades del movil en salida)
    assert.equal(await client.airCompressor.count(), result.compressors);
    assert(await client.personalEquipment.count() > 0);
    assert(await client.operationalDocument.count() > 0);
    assert.equal(await client.user.findUniqueOrThrow({ where: { id: original.id } }).then((u) => u.passwordHash), "preserved-changed-password-hash");
    const openAttendances = await client.attendance.findMany({ where: { status: "OPEN" } });
    assert(openAttendances.length >= 4);
    assert.equal(new Set(openAttendances.map(a => a.userId)).size, openAttendances.length, "Nunca dos fichajes abiertos por persona");
    assert(await client.operationalContact.count() > 0);
    assert(await client.complianceRecord.count() > 0);
    assert(await client.maintenanceJob.count({ where: { blocksOperation: true } }) > 0);
    assert.equal(await client.authSession.count({ where: { revokedAt: null } }), 0);
    execFileSync(process.execPath, [require.resolve("tsx/cli"), "src/scripts/logic-check.ts"], { env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: "inherit" });
    await client.firefighterProfile.update({ where: { userId: "demo_v2_bombero" }, data: { rank: "Bombero (Maquinista)" } });
    await client.inspection.update({ where: { id: "demo_v2_inspection_0" }, data: { summaryOk: 99 } });
    assert.equal((await repairDemoBusiness(client)).changes.length, 2);
    assert.equal((await client.inspection.findUniqueOrThrow({ where: { id: "demo_v2_inspection_0" } })).summaryOk, 99);
    assert.equal((await repairDemoBusiness(client, true)).changes.length, 2);
    assert.equal((await repairDemoBusiness(client, true)).changes.length, 0);
    assert.equal(await client.auditLog.count({ where: { action: "SYSTEM_DEMO_BUSINESS_REPAIRED" } }), 1);
    assert.equal((await client.user.findUniqueOrThrow({ where: { id: original.id } })).passwordHash, "preserved-changed-password-hash");
    const extraBefore = await client.user.findUniqueOrThrow({ where: { id: edited.id } });
    const session = await client.authSession.create({ data: { id: "demo_v2_reset_session", userId: original.id, refreshTokenHash: "a".repeat(64), expiresAt: new Date(Date.now() + 3600000) } });
    await seedDemo(client, DEMO_PASSWORD, { resetPasswords: true });
    assert((await client.authSession.findUniqueOrThrow({ where: { id: session.id } })).revokedAt, "Revocar sesiones anteriores al restablecer");
    for (const key of DEMO_LOGIN_KEYS) {
      const account = await client.user.findUniqueOrThrow({ where: { username: `demo.${key}` } });
      assert(await bcrypt.compare(DEMO_PASSWORD, account.passwordHash));
      assert.equal(account.mustChangePassword, false);
    }
    assert.equal((await client.user.findUniqueOrThrow({ where: { id: edited.id } })).passwordHash, extraBefore.passwordHash, "No restablecer cuentas fuera de la lista autorizada");
    const resetCounts = await counts();
    await seedDemo(client, DEMO_PASSWORD, { resetPasswords: true });
    assert.deepEqual(await counts(), resetCounts, "Repetir el restablecimiento no genera cambios si las claves ya coinciden");
    await client.auditLog.createMany({ data: [
      { action: "HTTP_ACCESS_DENIED", entityType: "HttpRequest", entityId: "denied-demo-test" },
      { action: "SYSTEM_PRESENCE_TIMED_OUT", entityType: "Attendance", entityId: "demo_v2_present_matias" },
    ] });
    await seedDemo(client, DEMO_PASSWORD);
    const appAlert = await client.alert.create({ data: {
      type: "OTHER", priority: "LOW", description: "Alerta demo creada desde la aplicacion con identificador automatico",
      location: "Sitio sintetico", createdByUserId: "demo_v2_bombero",
    } });
    const appResponse = await client.alertResponse.create({ data: { alertId: appAlert.id, userId: "demo_v2_operador", response: "NOT_GOING" } });
    await seedDemo(client, DEMO_PASSWORD);
    assert.deepEqual(await client.alertResponse.findUniqueOrThrow({ where: { id: appResponse.id } }), appResponse, "El seed debe reconocer y conservar respuestas creadas desde la app por cuentas demo");
    const appTask = await client.workTask.create({ data: { title: "Tarea demo creada desde la app", description: "Conservar su asignacion y su identificador automatico", createdByUserId: "demo_v2_oficial", members: { create: { userId: "demo_v2_bombero" } } } });
    await seedDemo(client, DEMO_PASSWORD);
    assert.equal(await client.workTaskMember.count({ where: { taskId: appTask.id, userId: "demo_v2_bombero" } }), 1, "Las relaciones anidadas de datos demo no son datos operativos ajenos");
    const automaticAbsence = await client.auditLog.create({ data: { action: "SYSTEM_SHIFT_ABSENCE_RECORDED", entityType: "Shift", entityId: "demo_v2_day", metadata: { userId: "demo_v2_bombero" } } });
    await seedDemo(client, DEMO_PASSWORD);
    assert(await client.auditLog.findUnique({ where: { id: automaticAbsence.id } }), "Se conserva la auditoria automatica de ausencias demo");
    const foreignAbsence = await client.auditLog.create({ data: { action: "SYSTEM_SHIFT_ABSENCE_RECORDED", entityType: "Shift", entityId: "demo_v2_day", metadata: { userId: "foreign_user" } } });
    await assert.rejects(() => seedDemo(client, password), /no exclusiva.*AuditLog/);
    await purgeAuditLogs(client, { id: foreignAbsence.id });
    const foreignAudit = await client.auditLog.create({ data: { action: "UNRELATED_REAL_OPERATION", entityType: "System", entityId: "not-demo" } });
    await assert.rejects(() => seedDemo(client, password), /no exclusiva/);
    await purgeAuditLogs(client, { id: foreignAudit.id });
    execFileSync(process.execPath, [require.resolve("tsx/cli"), "prisma/verify-demo-accounts.ts"], { env: { ...process.env, DATABASE_URL: databaseUrl, SEED_PASSWORD: DEMO_PASSWORD }, stdio: "inherit" });
    const externalAsset = await client.asset.create({ data: { name: "Registro ajeno de prueba", assetType: "OTHER" } });
    await assert.rejects(() => seedDemo(client, password), /no exclusiva/);
    await client.asset.delete({ where: { id: externalAsset.id } });
    await client.user.create({ data: { username: "real_account_probe", passwordHash: "not-a-real-login" } });
    await assert.rejects(() => seedDemo(client, password), /no exclusiva/);
    assert.equal(await client.user.count(), 21);
    console.log("Seed verificado: idempotencia, claves preservadas, relaciones y rechazo de base mixta.");
  } finally {
    await client.$disconnect();
    // This identifier is generated locally above, never supplied by the user or environment.
    if (!/^bomberos_demo_verify_[a-f0-9]{16}$/.test(schema)) throw new Error("Esquema temporal invalido");
    await root.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await root.$disconnect();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
