"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const strict_1 = __importDefault(require("node:assert/strict"));
const node_crypto_1 = require("node:crypto");
const bcrypt_1 = __importDefault(require("bcrypt"));
const isolated_api_test_1 = require("./isolated-api-test");
let app;
let prisma;
let flushRequestAudit;
async function main() {
    if (process.env.NODE_ENV === "production")
        throw new Error("Las pruebas con datos temporales no se ejecutan en produccion");
    const run = (0, node_crypto_1.randomUUID)().slice(0, 8), userIds = [], equipmentIds = [], assetIds = [], jobIds = [], requestIds = [];
    const password = `${(0, node_crypto_1.randomUUID)()}!Aa7`;
    const server = app.listen(0, "127.0.0.1");
    let paths = 0;
    try {
        await new Promise((resolve) => server.once("listening", resolve));
        const address = server.address();
        (0, strict_1.default)(address && typeof address !== "string");
        const base = `http://127.0.0.1:${address.port}/api`;
        const passwordHash = await bcrypt_1.default.hash(password, 10);
        for (const [index, role] of ["ADMIN", "OPERATOR", "FIREFIGHTER", "FIREFIGHTER"].entries()) {
            const user = await prisma.user.create({ data: { username: `__ppe_${run}_${index}`, passwordHash, role } });
            userIds.push(user.id);
        }
        async function request(path, expected, method = "GET", body, token) {
            const response = await fetch(base + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
            const data = await response.json();
            strict_1.default.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(data)}`);
            paths++;
            (0, strict_1.default)(!JSON.stringify(data).includes("passwordHash"));
            return data;
        }
        const tokens = [];
        for (let index = 0; index < userIds.length; index++)
            tokens.push((await request("/auth/login", 200, "POST", { username: `__ppe_${run}_${index}`, password })).tokens.accessToken);
        const [admin, operator, staff, other] = tokens;
        const requestsRoot = "/equipment-requests";
        await request(requestsRoot, 401);
        const requestInput = { category: "HELMET", size: "L", reason: "Necesito renovar el casco de prueba" };
        let clothingRequest = await request(requestsRoot, 201, "POST", requestInput, staff);
        requestIds.push(clothingRequest.id);
        await request(requestsRoot, 409, "POST", requestInput, staff);
        const otherRequests = await request(requestsRoot, 200, "GET", undefined, other);
        (0, strict_1.default)(!otherRequests.items.some((r) => r.id === clothingRequest.id));
        await request(`${requestsRoot}?userId=${userIds[2]}`, 403, "GET", undefined, other);
        await request(`${requestsRoot}/${clothingRequest.id}`, 404, "PUT", { ...requestInput, revision: clothingRequest.revision }, other);
        await request(`${requestsRoot}/${clothingRequest.id}`, 404, "PUT", { ...requestInput, revision: clothingRequest.revision }, admin);
        clothingRequest = await request(`${requestsRoot}/${clothingRequest.id}`, 200, "PUT", { ...requestInput, reason: "Pedido corregido antes de su aprobacion", revision: clothingRequest.revision }, staff);
        await request(`${requestsRoot}/${clothingRequest.id}/review`, 403, "POST", { revision: clothingRequest.revision, status: "APPROVED", notes: "Intento de autoaprobar el propio pedido" }, staff);
        clothingRequest = await request(`${requestsRoot}/${clothingRequest.id}/review`, 200, "POST", { revision: clothingRequest.revision, status: "APPROVED", notes: "Pedido autorizado por responsable de prueba" }, operator);
        await request(`${requestsRoot}/${clothingRequest.id}/review`, 409, "POST", { revision: clothingRequest.revision, status: "REJECTED", notes: "No se puede revisar un pedido ya aprobado" }, admin);
        await request(`${requestsRoot}/${clothingRequest.id}`, 409, "PUT", { ...requestInput, revision: clothingRequest.revision }, staff);
        const ownManagerRequest = await request(requestsRoot, 201, "POST", { category: "OTHER", reason: "Pedido temporal del responsable para verificar permisos" }, admin);
        requestIds.push(ownManagerRequest.id);
        await request(`${requestsRoot}/${ownManagerRequest.id}/review`, 403, "POST", { revision: 1, status: "APPROVED", notes: "Un responsable no puede aprobarse a si mismo" }, admin);
        await request(`${requestsRoot}/${ownManagerRequest.id}/cancel`, 404, "POST", { revision: 1 }, other);
        await request(`${requestsRoot}/${ownManagerRequest.id}/cancel`, 200, "POST", { revision: 1 }, admin);
        const rejected = await request(requestsRoot, 201, "POST", { category: "GLOVES", reason: "Pedido temporal para comprobar rechazo justificado" }, staff);
        requestIds.push(rejected.id);
        await request(`${requestsRoot}/${rejected.id}/review`, 200, "POST", { revision: 1, status: "REJECTED", notes: "Rechazo de prueba fundamentado por responsable" }, admin);
        await strict_1.default.rejects(() => prisma.personalEquipmentRequest.update({ where: { id: rejected.id }, data: { reviewedByUserId: userIds[2] } }), (error) => error.message.includes("PersonalEquipmentRequest_review_identity_time"));
        paths++;
        await request(`${requestsRoot}/${rejected.id}/cancel`, 409, "POST", { revision: 2 }, staff);
        const root = "/personal-equipment";
        const input = { code: `PPE-${run}`, name: "Casco temporal para pruebas", category: "HELMET", size: "M" };
        await request(root, 401);
        await request(root, 403, "POST", input, staff);
        await request(root, 403, "POST", input, operator);
        const created = await request(root, 201, "POST", input, admin);
        equipmentIds.push(created.id);
        assetIds.push(created.assetId);
        await request(root, 409, "POST", input, admin);
        async function item() { const list = await request(`${root}?q=${run}`, 200, "GET", undefined, admin); return list.items.find((row) => row.id === created.id); }
        let row = await item();
        strict_1.default.equal(row.available, false);
        strict_1.default.equal(row.asset.status, "MAINTENANCE");
        const path = `${root}/${created.id}`;
        await request(`${path}/issues`, 409, "POST", { revision: row.revision, userId: userIds[2] }, admin);
        await request(`${path}/checks`, 403, "POST", { revision: row.revision, condition: "OK", notes: "Material completo y sin novedades" }, staff);
        await request(`${path}/checks`, 403, "POST", { revision: row.revision, condition: "OK", notes: "Material completo y sin novedades" }, operator);
        await request(`${path}/checks`, 201, "POST", { revision: row.revision, condition: "OK", notes: "Material completo y sin novedades" }, admin);
        await request(`${path}/checks`, 409, "POST", { revision: row.revision, condition: "OK", notes: "Revision obsoleta no debe guardarse" }, admin);
        row = await item();
        (0, strict_1.default)(row.available);
        await request(`${path}/issues`, 409, "POST", { revision: row.revision, userId: userIds[2], requestId: clothingRequest.id, requestRevision: clothingRequest.revision }, admin);
        await prisma.user.update({ where: { id: userIds[3] }, data: { isActive: false } });
        await request(`${path}/issues`, 400, "POST", { revision: row.revision, userId: userIds[3] }, admin);
        await prisma.user.update({ where: { id: userIds[3] }, data: { isActive: true } });
        const simultaneous = await Promise.all([userIds[2], userIds[3]].map(async (userId) => {
            const response = await fetch(base + `${path}/issues`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${admin}` }, body: JSON.stringify({ revision: row.revision, userId, notes: "Entrega temporal confidencial" }) });
            return { status: response.status, data: await response.json() };
        }));
        strict_1.default.deepEqual(simultaneous.map((r) => r.status).sort(), [201, 409]);
        paths += 2;
        const issue = simultaneous.find((r) => r.status === 201).data;
        const holderIndex = userIds.indexOf(issue.userId), outsiderIndex = holderIndex === 2 ? 3 : 2;
        await request(`${root}?view=mine&q=${run}`, 403, "GET", undefined, tokens[holderIndex]);
        const owned = await request(`${root}?view=all&q=${run}`, 200, "GET", undefined, operator);
        strict_1.default.equal(owned.items.length, 1);
        (0, strict_1.default)(owned.items[0].currentIssue);
        const hidden = await request(`${root}?q=${run}`, 403, "GET", undefined, tokens[outsiderIndex]);
        (0, strict_1.default)(!JSON.stringify(hidden).includes("confidencial"));
        await request(`${path}/history`, 403, "GET", undefined, tokens[outsiderIndex]);
        await request(`${path}/history`, 403, "GET", undefined, tokens[holderIndex]);
        strict_1.default.equal((await request(`${path}/history`, 200, "GET", undefined, operator)).total, 1);
        await strict_1.default.rejects(() => prisma.personalEquipmentIssue.create({ data: { equipmentId: row.id, userId: userIds[2], issuedByUserId: userIds[0] } }), (error) => error.code === "P2002");
        paths++;
        row = await item();
        await request(path, 409, "PUT", { revision: row.revision, name: "Cambio durante entrega", category: "HELMET", size: "M" }, admin);
        await request(`${path}/archive`, 409, "POST", { revision: row.revision }, admin);
        await request(`/assets/${row.assetId}`, 400, "PUT", { status: "OPERATIONAL" }, admin);
        await request(`/assets/${row.assetId}`, 400, "DELETE", undefined, admin);
        await request(`${path}/return`, 403, "POST", { revision: row.revision, issueId: issue.id, condition: "OK" }, operator);
        await request(`${path}/return`, 400, "POST", { revision: row.revision, issueId: issue.id, condition: "OUT", notes: "" }, admin);
        await request(`${path}/return`, 409, "POST", { revision: row.revision, issueId: "different-issue", condition: "OK" }, admin);
        await request(`${path}/return`, 403, "POST", { revision: row.revision, issueId: issue.id, condition: "OK" }, tokens[holderIndex]);
        await request(`${path}/return`, 200, "POST", { revision: row.revision, issueId: issue.id, condition: "OK" }, admin);
        await request(`${path}/return`, 409, "POST", { revision: row.revision, issueId: issue.id, condition: "OK" }, admin);
        row = await item();
        strict_1.default.equal(row.available, false);
        strict_1.default.equal(row.assigned, false);
        strict_1.default.equal(row.asset.status, "MAINTENANCE");
        await request(`${path}/issues`, 409, "POST", { revision: row.revision, userId: userIds[2] }, admin);
        const job = await request("/operations/maintenance", 201, "POST", { assetId: row.assetId, title: "Revision temporal", description: "Verificar el elemento antes de habilitarlo.", publishTask: false, blocksOperation: true }, admin);
        jobIds.push(job.id);
        await request(`${path}/checks`, 409, "POST", { revision: row.revision, condition: "OK", notes: "No debe saltear mantenimiento pendiente" }, admin);
        await request(`/operations/maintenance/${job.id}/status`, 200, "PATCH", { revision: job.revision, status: "RESOLVED", resolution: "Reparacion de prueba terminada correctamente" }, admin);
        row = await item();
        strict_1.default.equal(row.available, false);
        await request(`${path}/checks`, 201, "POST", { revision: row.revision, condition: "OK", notes: "Revision posterior a la reparacion realizada" }, admin);
        row = await item();
        (0, strict_1.default)(row.available);
        await request(path, 200, "PUT", { revision: row.revision, name: "Casco de prueba actualizado", category: "HELMET", size: "L" }, admin);
        row = await item();
        await request(`${path}/issues`, 400, "POST", { revision: row.revision, userId: userIds[2], requestId: clothingRequest.id }, admin);
        await request(`${path}/issues`, 409, "POST", { revision: row.revision, userId: userIds[3], requestId: clothingRequest.id, requestRevision: clothingRequest.revision }, admin);
        const issueAgain = await request(`${path}/issues`, 201, "POST", { revision: row.revision, userId: userIds[2], requestId: clothingRequest.id, requestRevision: clothingRequest.revision }, admin);
        const fulfilledRequests = await request(`${requestsRoot}?status=FULFILLED`, 200, "GET", undefined, staff);
        const fulfilled = fulfilledRequests.items.find((r) => r.id === clothingRequest.id);
        (0, strict_1.default)(fulfilled);
        strict_1.default.equal(fulfilled.fulfilledIssue.id, issueAgain.id);
        await request(`${requestsRoot}/${clothingRequest.id}/cancel`, 409, "POST", { revision: fulfilled.revision }, staff);
        row = await item();
        await request(`${path}/return`, 200, "POST", { revision: row.revision, issueId: issueAgain.id, condition: "OUT", notes: "Material recibido con dano que impide usarlo" }, admin);
        row = await item();
        strict_1.default.equal(row.asset.status, "OUT_OF_SERVICE");
        await request(`${path}/archive`, 200, "POST", { revision: row.revision }, admin);
        await strict_1.default.rejects(() => prisma.personalEquipmentIssue.create({ data: { equipmentId: row.id, userId: userIds[2], issuedByUserId: userIds[0], receivedByUserId: userIds[0], returnCondition: "OK" } }), (error) => error.message.includes("PersonalEquipmentIssue_return_consistent"));
        paths++;
        await request(`${path}/checks`, 409, "POST", { revision: row.revision + 1, condition: "OK", notes: "No debe rehabilitar un elemento dado de baja" }, admin);
        strict_1.default.equal((await request(`${path}/history`, 200, "GET", undefined, admin)).total, 2);
        const archived = await request(`${root}?view=archived&q=${run}`, 200, "GET", undefined, admin);
        strict_1.default.equal(archived.total, 1);
        await request(`${root}?page=-1`, 400, "GET", undefined, admin);
        await request(`${root}?view=bad`, 400, "GET", undefined, admin);
        console.log(`Equipamiento personal API OK: ${paths} caminos; concurrencia, privacidad, mantenimiento, devolucion, bajas e historial.`);
    }
    finally {
        await new Promise((resolve) => server.close(() => resolve()));
        await flushRequestAudit();
        await prisma.personalEquipmentRequest.deleteMany({ where: { id: { in: requestIds } } });
        await prisma.personalEquipmentIssue.deleteMany({ where: { equipmentId: { in: equipmentIds } } });
        await prisma.personalEquipmentCheck.deleteMany({ where: { equipmentId: { in: equipmentIds } } });
        await prisma.personalEquipment.deleteMany({ where: { id: { in: equipmentIds } } });
        await prisma.maintenanceJob.deleteMany({ where: { id: { in: jobIds } } });
        await prisma.asset.deleteMany({ where: { id: { in: assetIds } } });
        await prisma.memberNotification.deleteMany({ where: { userId: { in: userIds } } });
        await prisma.auditLog.deleteMany({ where: { OR: [{ actorUserId: { in: userIds } }, { entityId: { in: [...equipmentIds, ...assetIds, ...jobIds, ...requestIds] } }] } });
        await prisma.user.deleteMany({ where: { id: { in: userIds } } });
        await prisma.$disconnect();
    }
}
(0, isolated_api_test_1.isolatedApiTest)(async () => { app = (await Promise.resolve().then(() => __importStar(require("../app")))).app; prisma = (await Promise.resolve().then(() => __importStar(require("../config/prisma")))).prisma; flushRequestAudit = (await Promise.resolve().then(() => __importStar(require("../middlewares/request-audit.middleware")))).flushRequestAudit; await main(); }).catch((error) => { console.error(error); process.exitCode = 1; });
