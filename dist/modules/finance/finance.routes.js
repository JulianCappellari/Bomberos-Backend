"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const prisma_1 = require("../../config/prisma");
const auth_middleware_1 = require("../../middlewares/auth.middleware");
const role_middleware_1 = require("../../middlewares/role.middleware");
const transaction_1 = require("../../utils/transaction");
const station_time_1 = require("../../utils/station-time");
const operations_schemas_1 = require("../operations/operations.schemas");
const firefighter_ranks_1 = require("../../utils/firefighter-ranks");
const finance_access_1 = require("../../utils/finance-access");
const notifications_service_1 = require("../members/notifications.service");
const work_photos_1 = require("../work/work-photos");
const router = (0, express_1.Router)();
router.use(auth_middleware_1.authenticate);
router.get("/access", async (req, res) => res.json(await (0, finance_access_1.financeAccess)(req.user.userId, req.user.role)));
router.get("/chiefs", async (req, res) => { if (!(await (0, finance_access_1.financeAccess)(req.user.userId, req.user.role)).canDelegate)
    throw new operations_schemas_1.OperationError(403, "Acceso reservado al administrador general"); res.json(await prisma_1.prisma.user.findMany({ where: { isActive: true, deletedAt: null, profile: { rank: { equals: "Oficial", mode: "insensitive" } } }, select: { id: true, username: true, financeChief: true, profile: { select: { fullName: true } } } })); });
router.post("/access/:userId", async (req, res) => {
    if (!(await (0, finance_access_1.financeAccess)(req.user.userId, req.user.role)).canDelegate)
        throw new operations_schemas_1.OperationError(403, "Solo el administrador general designa al jefe financiero");
    const { enabled, reason } = zod_1.z.object({ enabled: zod_1.z.boolean(), reason: zod_1.z.string().trim().min(10).max(1000) }).strict().parse(req.body), id = String(req.params.userId);
    res.json(await (0, transaction_1.serializable)(async (tx) => { const u = await tx.user.findUnique({ where: { id }, include: { profile: true } }); if (!u || !u.isActive || u.deletedAt || u.isPendingApproval || (0, firefighter_ranks_1.normalizeRank)(u.profile?.rank) !== "oficial")
        throw new operations_schemas_1.OperationError(400, "Seleccione un oficial activo"); await tx.user.update({ where: { id }, data: { financeChief: enabled } }); await tx.auditLog.create({ data: { actorUserId: req.user.userId, action: "FINANCE_CHIEF_CHANGED", entityType: "User", entityId: id, metadata: { before: u.financeChief, after: enabled, reason } } }); return { message: "Permiso financiero actualizado" }; }));
});
const cents = zod_1.z.number().int().positive().max(2000000000), revision = zod_1.z.number().int().positive();
const input = zod_1.z.object({ operationKey: zod_1.z.string().uuid(), title: zod_1.z.string().trim().min(3).max(160), notes: zod_1.z.string().trim().min(10).max(2000), occurredOn: zod_1.z.string().date().refine(v => v <= (0, station_time_1.stationDate)(), "La fecha no puede ser futura"), amountCents: cents, receiptPhoto: zod_1.z.string({ error: "Adjunte una foto del comprobante" }).min(1).max(250000).regex(/^[A-Za-z0-9+/]+={0,2}$/), receiptUrl: zod_1.z.string().url().max(500).refine(v => { const u = new URL(v); return u.protocol === "https:" && !u.username && !u.password; }, "El enlace debe ser HTTPS sin credenciales").nullable().default(null) }).strict();
router.get("/officer-expenses", (0, role_middleware_1.authorize)("OPERATOR"), async (req, res) => {
    const reviewer = await prisma_1.prisma.user.findUnique({ where: { id: req.user.userId }, select: { profile: { select: { rank: true } } } });
    if ((0, firefighter_ranks_1.normalizeRank)(reviewer?.profile?.rank) !== "sub oficial")
        throw new operations_schemas_1.OperationError(403, "Solo suboficiales pueden autorizar");
    const rows = await prisma_1.prisma.expenseClaim.findMany({ omit: { receiptBytes: true }, where: { officerExpense: true, status: { in: ["PENDING", "APPROVED"] } }, include: { user: { select: { username: true, profile: { select: { fullName: true } } } }, approvals: { include: { user: { select: { username: true } } } } }, orderBy: { createdAt: "desc" } });
    res.json(rows.filter(r => r.status === "PENDING" || r.approvals.filter(a => a.decision === "APPROVED" && a.rankSnapshot === "sub oficial").length < 2));
});
router.post("/expenses/:id/authorize", (0, role_middleware_1.authorize)("OPERATOR"), async (req, res) => {
    const id = String(req.params.id), { revision, note } = zod_1.z.object({ revision: zod_1.z.number().int().positive(), note: zod_1.z.string().trim().min(10).max(1000) }).strict().parse(req.body), actor = req.user.userId;
    res.json(await (0, transaction_1.serializable)(async (tx) => {
        await tx.$queryRaw `SELECT "id" FROM "ExpenseClaim" WHERE "id" = ${id} FOR UPDATE`;
        const row = await tx.expenseClaim.findUnique({ where: { id }, include: { approvals: true } }), reviewer = await tx.user.findUnique({ where: { id: actor }, include: { profile: true } });
        if (!row?.officerExpense || row.status === "REJECTED")
            throw new operations_schemas_1.OperationError(409, "Gasto no disponible para autorización");
        if (row.userId === actor || (0, firefighter_ranks_1.normalizeRank)(reviewer?.profile?.rank) !== "sub oficial")
            throw new operations_schemas_1.OperationError(403, "No puede autorizar este gasto");
        const old = row.approvals.find(a => a.userId === actor);
        if (old) {
            if (old.note !== note)
                throw new operations_schemas_1.OperationError(409, "Ya registró una autorización con otro texto");
            return { message: "Su autorización ya estaba registrada" };
        }
        if (row.revision !== revision)
            throw new operations_schemas_1.OperationError(409, "El gasto cambió. Actualice antes de autorizar");
        const approval = await tx.expenseApproval.create({ data: { claimId: id, userId: actor, rankSnapshot: "sub oficial", decision: "APPROVED", note } });
        const count = row.approvals.filter(a => a.decision === "APPROVED" && a.rankSnapshot === "sub oficial").length + 1;
        await tx.expenseClaim.update({ where: { id }, data: { status: count >= 2 ? "APPROVED" : "PENDING", revision: { increment: 1 }, reviewNote: count >= 2 ? "Autorizado por al menos dos suboficiales independientes" : row.reviewNote } });
        await tx.auditLog.create({ data: { actorUserId: actor, action: "OFFICER_EXPENSE_AUTHORIZED", entityType: "ExpenseClaim", entityId: id, metadata: { approvalId: approval.id, note, authorizations: count, amountCents: row.amountCents } } });
        return { message: count >= 2 ? "Segunda autorización registrada; gasto aprobado" : "Autorización registrada; falta otro suboficial", authorizations: count };
    }));
});
router.get("/expenses/:id/receipt", async (req, res) => {
    const row = await prisma_1.prisma.expenseClaim.findUnique({ where: { id: String(req.params.id) }, select: { receiptBytes: true, receiptSha256: true, userId: true, officerExpense: true } });
    if (!row)
        throw new operations_schemas_1.OperationError(404, "Comprobante no encontrado");
    if (row.userId !== req.user.userId && !(await (0, finance_access_1.financeAccess)(req.user.userId, req.user.role)).canManage && !(req.user.role === "OPERATOR" && row.officerExpense))
        throw new operations_schemas_1.OperationError(403, "No puede consultar este comprobante");
    if (!row.receiptBytes)
        throw new operations_schemas_1.OperationError(404, "Este gasto historico no tiene una imagen adjunta");
    res.set({ "Content-Type": "image/jpeg", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Disposition": "inline; filename=comprobante.jpg" }).send(Buffer.from(row.receiptBytes));
});
router.post("/expenses", async (req, res) => {
    const { receiptPhoto, ...data } = input.parse(req.body), userId = req.user.userId;
    const [receipt] = await (0, work_photos_1.sanitizeTaskPhotos)([receiptPhoto]);
    const id = await (0, transaction_1.serializable)(async (tx) => {
        const old = await tx.expenseClaim.findUnique({ where: { operationKey: data.operationKey } });
        if (old) {
            if (old.userId !== userId || old.title !== data.title || old.notes !== data.notes || old.amountCents !== data.amountCents || old.occurredOn.toISOString().slice(0, 10) !== data.occurredOn || old.receiptUrl !== data.receiptUrl || old.receiptSha256 !== receipt.sha256)
                throw new operations_schemas_1.OperationError(409, "La clave de envío ya se usó para otro gasto");
            return old.id;
        }
        const duplicate = await tx.expenseClaim.findFirst({ where: { status: { not: "REJECTED" }, OR: [{ userId, occurredOn: new Date(data.occurredOn), amountCents: data.amountCents, title: { equals: data.title, mode: "insensitive" } }, { receiptSha256: receipt.sha256 }, ...(data.receiptUrl ? [{ receiptUrl: data.receiptUrl }] : [])] }, select: { id: true } });
        if (duplicate)
            throw new operations_schemas_1.OperationError(409, "Existe una presentación coincidente. Solicite a jefatura revisar el comprobante antes de volver a presentarlo");
        const owner = await tx.user.findUnique({ where: { id: userId }, select: { profile: { select: { rank: true } } } });
        const row = await tx.expenseClaim.create({ data: { ...data, receiptBytes: receipt.bytes, receiptSha256: receipt.sha256, occurredOn: new Date(data.occurredOn), userId, officerExpense: (0, firefighter_ranks_1.normalizeRank)(owner?.profile?.rank) === "oficial" } });
        await tx.auditLog.create({ data: { actorUserId: userId, action: "EXPENSE_SUBMITTED", entityType: "ExpenseClaim", entityId: row.id, metadata: { amountCents: data.amountCents } } });
        await (0, notifications_service_1.notifyCommand)(tx, "Gasto presentado para revisión", "/finance", data.title + ": " + (data.amountCents / 100).toFixed(2) + " pesos", userId);
        return row.id;
    });
    res.status(201).json({ id, message: "Gasto presentado para revisión de jefatura. No se registró ningún pago." });
});
router.use(async (req, _res, next) => { if (!(await (0, finance_access_1.financeAccess)(req.user.userId, req.user.role)).canManage)
    throw new operations_schemas_1.OperationError(403, "Información reservada al jefe financiero y al administrador"); next(); });
router.get("/", async (req, res) => {
    const page = zod_1.z.coerce.number().int().min(1).max(10000).default(1).parse(req.query.page);
    const state = zod_1.z.enum(["all", "pending", "debt", "paid", "rejected"]).default("all").parse(req.query.state);
    const search = zod_1.z.string().trim().max(160).default("").parse(req.query.q).toLocaleLowerCase("es-AR");
    res.json(await prisma_1.prisma.$transaction(async (tx) => {
        const all = await tx.expenseClaim.findMany({ omit: { receiptBytes: true }, include: { payments: true, approvals: { include: { user: { select: { username: true, profile: { select: { fullName: true } } } } } } }, orderBy: [{ createdAt: "desc" }, { id: "asc" }] });
        const users = await tx.user.findMany({ select: { id: true, username: true, profile: { select: { fullName: true } } } });
        const water = await tx.waterTripMember.findMany({ where: { trip: { voidedAt: null } }, include: { trip: { select: { id: true, destination: true, returnedAt: true, revision: true, createdByUserId: true, earningsApprovedAt: true, earningsApprovalNote: true, asset: { select: { name: true } } } } } });
        const name = (id) => { const u = users.find(u => u.id === id); return u?.profile?.fullName || u?.username || "Cuenta archivada"; };
        const paid = (r) => r.payments.filter(p => !p.reversedAt).reduce((sum, p) => sum + p.amountCents, 0);
        const rows = all.map(r => ({ ...r, name: name(r.userId), paidCents: paid(r), debtCents: r.status === "APPROVED" ? r.amountCents - paid(r) : 0 }));
        const filtered = rows.filter(r => (!search || `${r.title} ${r.name}`.toLocaleLowerCase("es-AR").includes(search)) && (state === "all" || state === "pending" && r.status === "PENDING" || state === "rejected" && r.status === "REJECTED" || state === "debt" && r.debtCents > 0 || state === "paid" && r.status === "APPROVED" && r.debtCents === 0));
        return { items: filtered.slice((page - 1) * 30, page * 30), total: filtered.length,
            totals: { pendingApprovalCents: all.filter(r => r.status === "PENDING").reduce((s, r) => s + r.amountCents, 0), expenseDebtCents: all.filter(r => r.status === "APPROVED").reduce((s, r) => s + r.amountCents - paid(r), 0), expensePaidCents: all.reduce((s, r) => s + paid(r), 0), waterPendingCents: water.filter(w => !w.paidAt && !w.trip.earningsApprovedAt).reduce((s, w) => s + w.compensationCents, 0), waterDebtCents: water.filter(w => !w.paidAt && w.trip.earningsApprovedAt).reduce((s, w) => s + w.compensationCents, 0), waterPaidCents: water.filter(w => w.paidAt).reduce((s, w) => s + w.compensationCents, 0) },
            water: water.filter(w => w.compensationCents > 0).sort((a, b) => +b.trip.returnedAt - +a.trip.returnedAt).slice(0, 50).map(w => ({ userId: w.userId, name: name(w.userId), tripId: w.tripId, amountCents: w.compensationCents, paidAt: w.paidAt, canApprove: w.trip.createdByUserId !== req.user.userId && !water.some(m => m.tripId === w.tripId && m.userId === req.user.userId), ...w.trip })) };
    }, { isolationLevel: "RepeatableRead" }));
});
router.post("/expenses/:id/review", async (req, res) => {
    const id = String(req.params.id), data = zod_1.z.object({ revision, status: zod_1.z.enum(["APPROVED", "REJECTED"]), note: zod_1.z.string().trim().min(10).max(1000) }).strict().parse(req.body);
    res.json(await (0, transaction_1.serializable)(async (tx) => {
        const row = await tx.expenseClaim.findUnique({ where: { id } });
        if (!row)
            throw new operations_schemas_1.OperationError(404, "Gasto no encontrado");
        if (row.userId === req.user.userId)
            throw new operations_schemas_1.OperationError(403, "Otra persona de jefatura debe revisar el gasto propio");
        if (row.officerExpense && data.status === "APPROVED")
            throw new operations_schemas_1.OperationError(409, "Los gastos de oficiales necesitan autorización de dos suboficiales distintos");
        if (!(await tx.expenseClaim.updateMany({ where: { id, revision: data.revision, status: "PENDING" }, data: { status: data.status, reviewNote: data.note, revision: { increment: 1 } } })).count)
            throw new operations_schemas_1.OperationError(409, "El gasto ya fue revisado o cambió");
        const reviewer = await tx.user.findUnique({ where: { id: req.user.userId }, select: { profile: { select: { rank: true } } } });
        await tx.expenseApproval.create({ data: { claimId: id, userId: req.user.userId, decision: data.status, rankSnapshot: (0, firefighter_ranks_1.normalizeRank)(reviewer?.profile?.rank) || "administrador", note: data.note } });
        await tx.auditLog.create({ data: { actorUserId: req.user.userId, action: "EXPENSE_" + data.status, entityType: "ExpenseClaim", entityId: id, metadata: data } });
        return { message: "Revisión registrada" };
    }));
});
router.post("/water/:id/approve", async (req, res) => {
    const id = String(req.params.id), input = zod_1.z.object({ revision, note: zod_1.z.string().trim().min(10).max(1000) }).strict().parse(req.body), actor = req.user.userId;
    res.json(await (0, transaction_1.serializable)(async (tx) => {
        const row = await tx.waterTrip.findUnique({ where: { id }, include: { crew: true } });
        if (!row || row.voidedAt || row.earningsApprovedAt || row.revision !== input.revision)
            throw new operations_schemas_1.OperationError(409, "El viaje cambió, fue anulado o ya tiene revisión financiera");
        if (row.createdByUserId === actor || row.crew.some(m => m.userId === actor))
            throw new operations_schemas_1.OperationError(403, "Otra persona financiera independiente debe verificar este viaje");
        await tx.waterTrip.update({ where: { id }, data: { earningsApprovedAt: new Date(), earningsApprovedById: actor, earningsApprovalNote: input.note, revision: { increment: 1 } } });
        await tx.auditLog.create({ data: { actorUserId: actor, action: "WATER_EARNINGS_APPROVED", entityType: "WaterTrip", entityId: id, metadata: { note: input.note, revision: input.revision, crew: row.crew.map(m => ({ userId: m.userId, compensationCents: m.compensationCents })), chargeCents: row.chargeCents } } });
        return { message: "Compensaciones revisadas y deuda reconocida; no se transfirió dinero" };
    }));
});
router.post("/expenses/:id/payments", async (req, res) => {
    const id = String(req.params.id), data = zod_1.z.object({ operationKey: zod_1.z.string().uuid(), revision, amountCents: cents, reference: zod_1.z.string().trim().min(5).max(500) }).strict().parse(req.body);
    res.status(201).json(await (0, transaction_1.serializable)(async (tx) => {
        const existing = await tx.expensePayment.findUnique({ where: { operationKey: data.operationKey } });
        if (existing) {
            if (existing.claimId !== id || existing.amountCents !== data.amountCents || existing.reference !== data.reference)
                throw new operations_schemas_1.OperationError(409, "Clave de pago utilizada");
            return { id: existing.id };
        }
        const claim = await tx.expenseClaim.findUnique({ where: { id }, include: { payments: true, approvals: true } });
        if (!claim || claim.status !== "APPROVED")
            throw new operations_schemas_1.OperationError(409, "El gasto debe estar aprobado");
        if (claim.officerExpense && claim.approvals.filter(a => a.decision === "APPROVED" && a.rankSnapshot === "sub oficial").length < 2)
            throw new operations_schemas_1.OperationError(409, "Faltan dos autorizaciones independientes de suboficiales");
        if (claim.userId === req.user.userId)
            throw new operations_schemas_1.OperationError(403, "Otra persona de jefatura debe registrar su pago");
        if (claim.payments.some(p => !p.reversedAt && p.reference.toLocaleLowerCase() === data.reference.toLocaleLowerCase()))
            throw new operations_schemas_1.OperationError(409, "Ya existe una constancia vigente con esa referencia para este gasto");
        const balance = claim.amountCents - claim.payments.filter(p => !p.reversedAt).reduce((s, p) => s + p.amountCents, 0);
        if (data.amountCents > balance)
            throw new operations_schemas_1.OperationError(409, "El importe supera la deuda pendiente");
        if (!(await tx.expenseClaim.updateMany({ where: { id, revision: data.revision }, data: { revision: { increment: 1 } } })).count)
            throw new operations_schemas_1.OperationError(409, "El gasto cambió");
        const row = await tx.expensePayment.create({ data: { operationKey: data.operationKey, claimId: id, amountCents: data.amountCents, reference: data.reference } });
        await tx.auditLog.create({ data: { actorUserId: req.user.userId, action: "EXPENSE_PAYMENT_RECORDED", entityType: "ExpenseClaim", entityId: id, metadata: { paymentId: row.id, amountCents: data.amountCents, reference: data.reference } } });
        return { id: row.id, message: "Constancia registrada. No se transfirió dinero desde el sistema." };
    }));
});
router.post("/payments/:id/reverse", async (req, res) => {
    const id = String(req.params.id), { reason } = zod_1.z.object({ reason: zod_1.z.string().trim().min(10).max(1000) }).strict().parse(req.body);
    res.json(await (0, transaction_1.serializable)(async (tx) => {
        const old = await tx.expensePayment.findUnique({ where: { id } });
        if (!old || old.reversedAt)
            throw new operations_schemas_1.OperationError(409, "Pago inexistente o ya revertido");
        const claim = await tx.expenseClaim.findUniqueOrThrow({ where: { id: old.claimId } });
        if (claim.userId === req.user.userId)
            throw new operations_schemas_1.OperationError(403, "Otra persona financiera debe revertir su pago propio");
        await tx.expenseClaim.update({ where: { id: old.claimId }, data: { revision: { increment: 1 } } });
        await tx.expensePayment.update({ where: { id }, data: { reversedAt: new Date() } });
        await tx.auditLog.create({ data: { actorUserId: req.user.userId, action: "EXPENSE_PAYMENT_REVERSED", entityType: "ExpenseClaim", entityId: old.claimId, metadata: { paymentId: id, reason } } });
        return { message: "Constancia revertida; deuda recalculada" };
    }));
});
exports.default = router;
