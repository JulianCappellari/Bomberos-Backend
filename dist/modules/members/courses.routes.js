"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const prisma_1 = require("../../config/prisma");
const role_middleware_1 = require("../../middlewares/role.middleware");
const transaction_1 = require("../../utils/transaction");
const station_time_1 = require("../../utils/station-time");
const operations_schemas_1 = require("../operations/operations.schemas");
const notifications_service_1 = require("./notifications.service");
const router = (0, express_1.Router)();
const input = zod_1.z.object({ title: zod_1.z.string().trim().min(3).max(160), provider: zod_1.z.string().trim().min(2).max(160),
    completedOn: zod_1.z.string().date().refine(day => day <= (0, station_time_1.stationDate)(), "La fecha del curso no puede ser futura") }).strict();
router.get("/", async (req, res) => {
    const { scope, page } = zod_1.z.object({ scope: zod_1.z.enum(["mine", "pending"]).default("mine"), page: zod_1.z.coerce.number().int().min(1).max(10000).default(1) }).parse(req.query);
    if (scope === "pending" && !["ADMIN", "OPERATOR"].includes(req.user.role))
        throw new operations_schemas_1.OperationError(403, "Acceso reservado a jefatura");
    res.json(await prisma_1.prisma.courseAttendance.findMany({ where: scope === "mine" ? { userId: req.user.userId } : { status: "PENDING" },
        include: { user: { select: { username: true } }, reviewer: { select: { username: true } } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 30, skip: (page - 1) * 30 }));
});
router.post("/", async (req, res) => {
    const data = input.parse(req.body), userId = req.user.userId, completedOn = new Date(data.completedOn);
    const result = await (0, transaction_1.serializable)(async (tx) => {
        if (await tx.courseAttendance.findFirst({ where: { userId, title: { equals: data.title, mode: "insensitive" }, provider: { equals: data.provider, mode: "insensitive" }, completedOn, status: { not: "REJECTED" } } }))
            throw new operations_schemas_1.OperationError(409, "Este curso ya fue declarado para esa fecha");
        const row = await tx.courseAttendance.create({ data: { ...data, completedOn, userId } });
        await tx.auditLog.create({ data: { actorUserId: userId, action: "COURSE_SUBMITTED", entityType: "CourseAttendance", entityId: row.id } });
        const reviewers = await tx.user.findMany({ where: { id: { not: userId }, isActive: true, deletedAt: null, isPendingApproval: false, OR: [{ role: { in: ["ADMIN", "OPERATOR"] } }, { profile: { rank: { in: ["Administrador", "Oficial", "Sub oficial"] } } }] }, select: { id: true } });
        await (0, notifications_service_1.notify)(tx, reviewers.map(r => r.id), `Curso por revisar: ${row.title}`, "/courses");
        return row;
    });
    res.status(201).json(result);
});
router.post("/:id/review", (0, role_middleware_1.authorize)("ADMIN", "OPERATOR"), async (req, res) => {
    const { status, note } = zod_1.z.object({ status: zod_1.z.enum(["APPROVED", "REJECTED"]), note: zod_1.z.string().trim().max(1000).default("") }).strict().parse(req.body);
    if (status === "REJECTED" && note.length < 5)
        throw new operations_schemas_1.OperationError(400, "Indique el motivo del rechazo");
    const id = String(req.params.id), reviewerId = req.user.userId;
    res.json(await (0, transaction_1.serializable)(async (tx) => {
        const row = await tx.courseAttendance.findUnique({ where: { id } });
        if (!row)
            throw new operations_schemas_1.OperationError(404, "Curso no encontrado");
        if (row.userId === reviewerId)
            throw new operations_schemas_1.OperationError(403, "No puede revisar su propio curso");
        if (!(await tx.courseAttendance.updateMany({ where: { id, status: "PENDING" }, data: { reviewerId, reviewedAt: new Date(), reviewNote: note || null, status } })).count)
            throw new operations_schemas_1.OperationError(409, "Este curso ya fue revisado");
        await tx.auditLog.create({ data: { actorUserId: reviewerId, action: `COURSE_${status}`, entityType: "CourseAttendance", entityId: id, metadata: { note, userId: row.userId } } });
        await (0, notifications_service_1.notify)(tx, [row.userId], `Curso ${status === "APPROVED" ? "aprobado" : "rechazado"}: ${row.title}`, "/courses", note);
        return { status };
    }));
});
exports.default = router;
