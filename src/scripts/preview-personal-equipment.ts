import "dotenv/config";
import { randomUUID } from "node:crypto";
import bcrypt from "bcrypt";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { app } from "../app";
import { env } from "../config/env";
import { prisma } from "../config/prisma";
import { createPersonalEquipment, checkPersonalEquipment, issuePersonalEquipment } from "../modules/personal-equipment/personal-equipment.service";
import { createEquipmentRequest } from "../modules/personal-equipment/equipment-requests.service";
import { createAirCylinder, createAirCompressor, recordHydro, updateAirStatus, recordAirFill } from "../modules/air/air.service";
import { stationDate } from "../utils/station-time";

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("La vista de prueba no puede ejecutarse en produccion");
  const reuse = process.argv.includes("--reuse");
  const airMode = process.argv.includes("--air");
  const run = randomUUID().slice(0, 8), ids: string[] = [], assets: string[] = [], items: string[] = [];
  const airCylinders: string[] = [], airCompressors: string[] = [];
  const password = randomUUID() + "!Aa7";
  const probe = net.createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const address = probe.address(); if (!address || typeof address === "string") throw new Error("Puerto invalido");
  const frontendPort = address.port;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  const origin = reuse ? "http://localhost:3000" : `http://localhost:${frontendPort}`;
  env.corsOrigins.push(origin);
  let api: ReturnType<typeof app.listen> | undefined;
  let web: ReturnType<typeof spawn> | undefined;
  try {
    const hash = await bcrypt.hash(password, 10);
    for (const [index, role] of (["ADMIN", "FIREFIGHTER"] as const).entries()) {
      const user = await prisma.user.create({ data: { username: `__preview_${run}_${index}`, passwordHash: hash, role, profile: { create: { fullName: `Personal visual temporal ${index}`, rank: index === 0 ? "Oficial" : "Bombero", badge: `V-${run}-${index}`, dni: `V-${run}-${index}` } } } }); ids.push(user.id);
    }
    if (!airMode) {
    for (const [index, category] of (["HELMET", "COAT", "GLOVES"] as const).entries()) {
      const item = await createPersonalEquipment({ code: `VIS-${run}-${index}`, name: ["Casco estructural de prueba", "Chaqueton de prueba", "Guantes pendientes de revision"][index]!, category, size: "M" }, ids[0]!);
      items.push(item.id); assets.push(item.assetId);
      if (index < 2) await checkPersonalEquipment(item.id, { revision: 1, condition: "OK", notes: "Revision fisica ficticia para prueba visual" }, ids[0]!);
      if (index === 1) await issuePersonalEquipment(item.id, { revision: 2, userId: ids[1]!, notes: "Entrega ficticia para prueba visual" }, ids[0]!);
    }
    await createEquipmentRequest({ category: "BOOTS", size: "42", reason: "Necesito reemplazar las botas de entrenamiento de prueba" }, ids[1]!);
    } else {
      const today = stationDate(), future = new Date(today + "T00:00:00Z"); future.setUTCDate(future.getUTCDate() + 30); const until = future.toISOString().slice(0, 10);
      for (let index = 0; index < 2; index++) {
        const comp = await createAirCompressor({ code: `VIS-COMP-${run}-${index}`, name: index ? "Compresor de prueba con filtro agotado" : "Compresor de prueba", maxPressureBar: 300, filterLifeMinutes: 60, filterReference: "MANUAL-FICTICIO-NO-USAR", filterInstalledAt: new Date(Date.now() - 86400000).toISOString(), initialTotalMinutes: index ? 60 : 0, initialFilterUsedMinutes: index ? 60 : 0 }, ids[0]!);
        airCompressors.push(comp.id); assets.push(comp.assetId);
        if (!index) await updateAirStatus("compressor", comp.id, { revision: 1, status: "OPERATIONAL", notes: "Revision y calidad de aire ficticias", airQualityReference: "CALIDAD-FICTICIA-NO-CERTIFICADO", airQualityValidUntil: until }, ids[0]!);
      }
      for (let index = 0; index < 2; index++) {
        const tube = await createAirCylinder({ code: `VIS-ERA-${run}-${index}`, name: index ? "Cilindro pendiente de documentacion" : "Cilindro de entrenamiento ficticio", serialNumber: `SERIE-VIS-${run}-${index}`, ratedPressureBar: 300 }, ids[0]!);
        airCylinders.push(tube.id); assets.push(tube.assetId);
        if (!index) {
          await recordHydro(tube.id, { revision: 1, result: "PASS", testedOn: today, validUntil: until, certificateReference: "CERT-FICTICIO-NO-OPERATIVO", notes: "Documento ficticio para prueba visual" }, ids[0]!);
          await updateAirStatus("cylinder", tube.id, { revision: 2, status: "OPERATIONAL", notes: "Revision favorable ficticia para prueba visual" }, ids[0]!);
        }
      }
      const startedAt = new Date().toISOString(); await new Promise((resolve) => setTimeout(resolve, 10));
      await recordAirFill({ operationKey: randomUUID(), compressorId: airCompressors[0]!, revision: 2, startedAt, endedAt: new Date().toISOString(), operatorUserId: ids[1]!, helperUserIds: [], reason: "TRAINING", notes: "Carga ficticia para verificar la interfaz", items: [{ cylinderId: airCylinders[0]!, revision: 3, pressureBar: 200 }] }, ids[0]!);
    }
    if (reuse) {
      const apiResponse = await fetch("http://localhost:4000/api/personal-equipment", { headers: { Origin: origin } });
      if (apiResponse.status !== 401 || apiResponse.headers.get("access-control-allow-origin") !== origin) throw new Error("Los servidores existentes no estan listos para la prueba");
      await apiResponse.text();
    } else {
      api = app.listen(4000);
      await new Promise<void>((resolve, reject) => { api!.once("listening", resolve); api!.once("error", reject); });
      const next = path.resolve("../Bomberos - Frontend/node_modules/next/dist/bin/next");
      web = spawn(process.execPath, [next, "start", "-p", String(frontendPort)], { cwd: path.resolve("../Bomberos - Frontend"), stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
      web.stdout?.on("data", (data) => process.stdout.write(data)); web.stderr?.on("data", (data) => process.stderr.write(data));
    }
    const reader = createInterface({ input: process.stdin });
    console.log(JSON.stringify({ preview: origin + "/login", username: `__preview_${run}_0`, password, run, notice: "Solo cuentas y datos visuales temporales. Enter termina y limpia." }));
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => { reader.close(); resolve(); }, 15 * 60000);
      reader.once("line", () => { clearTimeout(timeout); reader.close(); resolve(); });
      reader.once("close", () => { clearTimeout(timeout); resolve(); });
    });
  } finally {
    if (web && web.exitCode === null) { const done = new Promise<void>((resolve) => web!.once("exit", () => resolve())); web.kill(); await done; }
    if (api) await new Promise<void>((resolve) => api!.close(() => resolve()));
    const airFillIds = (await prisma.airFill.findMany({ where: { compressorId: { in: airCompressors } }, select: { id: true } })).map((row) => row.id);
    await prisma.airFillHelper.deleteMany({ where: { fillId: { in: airFillIds } } });
    await prisma.airFillItem.deleteMany({ where: { fillId: { in: airFillIds } } });
    await prisma.airFill.deleteMany({ where: { id: { in: airFillIds } } });
    await prisma.airHydroTest.deleteMany({ where: { cylinderId: { in: airCylinders } } });
    await prisma.airFilterChange.deleteMany({ where: { compressorId: { in: airCompressors } } });
    await prisma.airCylinder.deleteMany({ where: { id: { in: airCylinders } } });
    await prisma.airCompressor.deleteMany({ where: { id: { in: airCompressors } } });
    await prisma.personalEquipmentRequest.deleteMany({ where: { userId: { in: ids } } });
    await prisma.personalEquipmentIssue.deleteMany({ where: { equipmentId: { in: items } } });
    await prisma.personalEquipmentCheck.deleteMany({ where: { equipmentId: { in: items } } });
    await prisma.personalEquipment.deleteMany({ where: { id: { in: items } } });
    await prisma.asset.deleteMany({ where: { id: { in: assets } } });
    await prisma.auditLog.deleteMany({ where: { actorUserId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
    console.log("Vista de prueba cerrada y datos temporales eliminados.");
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
