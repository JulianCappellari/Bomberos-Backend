"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const node_crypto_1 = require("node:crypto");
const bcrypt_1 = __importDefault(require("bcrypt"));
const node_net_1 = __importDefault(require("node:net"));
const node_path_1 = __importDefault(require("node:path"));
const node_child_process_1 = require("node:child_process");
const node_readline_1 = require("node:readline");
const app_1 = require("../app");
const env_1 = require("../config/env");
const prisma_1 = require("../config/prisma");
const personal_equipment_service_1 = require("../modules/personal-equipment/personal-equipment.service");
const equipment_requests_service_1 = require("../modules/personal-equipment/equipment-requests.service");
const air_service_1 = require("../modules/air/air.service");
const station_time_1 = require("../utils/station-time");
async function main() {
    if (process.env.NODE_ENV === "production")
        throw new Error("La vista de prueba no puede ejecutarse en produccion");
    const reuse = process.argv.includes("--reuse");
    const airMode = process.argv.includes("--air");
    const run = (0, node_crypto_1.randomUUID)().slice(0, 8), ids = [], assets = [], items = [];
    const airCylinders = [], airCompressors = [];
    const password = (0, node_crypto_1.randomUUID)() + "!Aa7";
    const probe = node_net_1.default.createServer();
    await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
    const address = probe.address();
    if (!address || typeof address === "string")
        throw new Error("Puerto invalido");
    const frontendPort = address.port;
    await new Promise((resolve) => probe.close(() => resolve()));
    const origin = reuse ? "http://localhost:3000" : `http://localhost:${frontendPort}`;
    env_1.env.corsOrigins.push(origin);
    let api;
    let web;
    try {
        const hash = await bcrypt_1.default.hash(password, 10);
        for (const [index, role] of ["ADMIN", "FIREFIGHTER"].entries()) {
            const user = await prisma_1.prisma.user.create({ data: { username: `__preview_${run}_${index}`, passwordHash: hash, role, profile: { create: { fullName: `Personal visual temporal ${index}`, rank: index === 0 ? "Oficial" : "Bombero", badge: `V-${run}-${index}`, dni: `V-${run}-${index}` } } } });
            ids.push(user.id);
        }
        if (!airMode) {
            for (const [index, category] of ["HELMET", "COAT", "GLOVES"].entries()) {
                const item = await (0, personal_equipment_service_1.createPersonalEquipment)({ code: `VIS-${run}-${index}`, name: ["Casco estructural de prueba", "Chaqueton de prueba", "Guantes pendientes de revision"][index], category, size: "M" }, ids[0]);
                items.push(item.id);
                assets.push(item.assetId);
                if (index < 2)
                    await (0, personal_equipment_service_1.checkPersonalEquipment)(item.id, { revision: 1, condition: "OK", notes: "Revision fisica ficticia para prueba visual" }, ids[0]);
                if (index === 1)
                    await (0, personal_equipment_service_1.issuePersonalEquipment)(item.id, { revision: 2, userId: ids[1], notes: "Entrega ficticia para prueba visual" }, ids[0]);
            }
            await (0, equipment_requests_service_1.createEquipmentRequest)({ category: "BOOTS", size: "42", reason: "Necesito reemplazar las botas de entrenamiento de prueba" }, ids[1]);
        }
        else {
            const today = (0, station_time_1.stationDate)(), future = new Date(today + "T00:00:00Z");
            future.setUTCDate(future.getUTCDate() + 30);
            const until = future.toISOString().slice(0, 10);
            for (let index = 0; index < 2; index++) {
                const comp = await (0, air_service_1.createAirCompressor)({ code: `VIS-COMP-${run}-${index}`, name: index ? "Compresor de prueba con filtro agotado" : "Compresor de prueba", maxPressureBar: 300, filterLifeMinutes: 60, filterReference: "MANUAL-FICTICIO-NO-USAR", filterInstalledAt: new Date(Date.now() - 86400000).toISOString(), initialTotalMinutes: index ? 60 : 0, initialFilterUsedMinutes: index ? 60 : 0 }, ids[0]);
                airCompressors.push(comp.id);
                assets.push(comp.assetId);
                if (!index)
                    await (0, air_service_1.updateAirStatus)("compressor", comp.id, { revision: 1, status: "OPERATIONAL", notes: "Revision y calidad de aire ficticias", airQualityReference: "CALIDAD-FICTICIA-NO-CERTIFICADO", airQualityValidUntil: until }, ids[0]);
            }
            for (let index = 0; index < 2; index++) {
                const tube = await (0, air_service_1.createAirCylinder)({ code: `VIS-ERA-${run}-${index}`, name: index ? "Cilindro pendiente de documentacion" : "Cilindro de entrenamiento ficticio", serialNumber: `SERIE-VIS-${run}-${index}`, ratedPressureBar: 300 }, ids[0]);
                airCylinders.push(tube.id);
                assets.push(tube.assetId);
                if (!index) {
                    await (0, air_service_1.recordHydro)(tube.id, { revision: 1, result: "PASS", testedOn: today, validUntil: until, certificateReference: "CERT-FICTICIO-NO-OPERATIVO", notes: "Documento ficticio para prueba visual" }, ids[0]);
                    await (0, air_service_1.updateAirStatus)("cylinder", tube.id, { revision: 2, status: "OPERATIONAL", notes: "Revision favorable ficticia para prueba visual" }, ids[0]);
                }
            }
            const startedAt = new Date().toISOString();
            await new Promise((resolve) => setTimeout(resolve, 10));
            await (0, air_service_1.recordAirFill)({ operationKey: (0, node_crypto_1.randomUUID)(), compressorId: airCompressors[0], revision: 2, startedAt, endedAt: new Date().toISOString(), operatorUserId: ids[1], helperUserIds: [], reason: "TRAINING", notes: "Carga ficticia para verificar la interfaz", items: [{ cylinderId: airCylinders[0], revision: 3, pressureBar: 200 }] }, ids[0]);
        }
        if (reuse) {
            const apiResponse = await fetch("http://localhost:4000/api/personal-equipment", { headers: { Origin: origin } });
            if (apiResponse.status !== 401 || apiResponse.headers.get("access-control-allow-origin") !== origin)
                throw new Error("Los servidores existentes no estan listos para la prueba");
            await apiResponse.text();
        }
        else {
            api = app_1.app.listen(4000);
            await new Promise((resolve, reject) => { api.once("listening", resolve); api.once("error", reject); });
            const next = node_path_1.default.resolve("../Bomberos - Frontend/node_modules/next/dist/bin/next");
            web = (0, node_child_process_1.spawn)(process.execPath, [next, "start", "-p", String(frontendPort)], { cwd: node_path_1.default.resolve("../Bomberos - Frontend"), stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
            web.stdout?.on("data", (data) => process.stdout.write(data));
            web.stderr?.on("data", (data) => process.stderr.write(data));
        }
        const reader = (0, node_readline_1.createInterface)({ input: process.stdin });
        console.log(JSON.stringify({ preview: origin + "/login", username: `__preview_${run}_0`, password, run, notice: "Solo cuentas y datos visuales temporales. Enter termina y limpia." }));
        await new Promise((resolve) => {
            const timeout = setTimeout(() => { reader.close(); resolve(); }, 15 * 60000);
            reader.once("line", () => { clearTimeout(timeout); reader.close(); resolve(); });
            reader.once("close", () => { clearTimeout(timeout); resolve(); });
        });
    }
    finally {
        if (web && web.exitCode === null) {
            const done = new Promise((resolve) => web.once("exit", () => resolve()));
            web.kill();
            await done;
        }
        if (api)
            await new Promise((resolve) => api.close(() => resolve()));
        const airFillIds = (await prisma_1.prisma.airFill.findMany({ where: { compressorId: { in: airCompressors } }, select: { id: true } })).map((row) => row.id);
        await prisma_1.prisma.airFillHelper.deleteMany({ where: { fillId: { in: airFillIds } } });
        await prisma_1.prisma.airFillItem.deleteMany({ where: { fillId: { in: airFillIds } } });
        await prisma_1.prisma.airFill.deleteMany({ where: { id: { in: airFillIds } } });
        await prisma_1.prisma.airHydroTest.deleteMany({ where: { cylinderId: { in: airCylinders } } });
        await prisma_1.prisma.airFilterChange.deleteMany({ where: { compressorId: { in: airCompressors } } });
        await prisma_1.prisma.airCylinder.deleteMany({ where: { id: { in: airCylinders } } });
        await prisma_1.prisma.airCompressor.deleteMany({ where: { id: { in: airCompressors } } });
        await prisma_1.prisma.personalEquipmentRequest.deleteMany({ where: { userId: { in: ids } } });
        await prisma_1.prisma.personalEquipmentIssue.deleteMany({ where: { equipmentId: { in: items } } });
        await prisma_1.prisma.personalEquipmentCheck.deleteMany({ where: { equipmentId: { in: items } } });
        await prisma_1.prisma.personalEquipment.deleteMany({ where: { id: { in: items } } });
        await prisma_1.prisma.asset.deleteMany({ where: { id: { in: assets } } });
        await prisma_1.prisma.auditLog.deleteMany({ where: { actorUserId: { in: ids } } });
        await prisma_1.prisma.user.deleteMany({ where: { id: { in: ids } } });
        await prisma_1.prisma.$disconnect();
        console.log("Vista de prueba cerrada y datos temporales eliminados.");
    }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
