import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../config/prisma";
import { authorize } from "../../middlewares/role.middleware";
import { serializable } from "../../utils/transaction";
import { stationDate } from "../../utils/station-time";
import { OperationError } from "../operations/operations.schemas";
import { notify } from "./notifications.service";

const router = Router();
const input = z.object({ title: z.string().trim().min(3).max(160), provider: z.string().trim().min(2).max(160),
  completedOn: z.string().date().refine(day => day <= stationDate(), "La fecha del curso no puede ser futura") }).strict();
router.get("/", async (req, res) => {
  const { scope, page } = z.object({ scope: z.enum(["mine", "pending"]).default("mine"), page: z.coerce.number().int().min(1).max(10000).default(1) }).parse(req.query);
  if (scope === "pending" && !["ADMIN","OPERATOR"].includes(req.user!.role)) throw new OperationError(403, "Acceso reservado a jefatura");
  res.json(await prisma.courseAttendance.findMany({ where: scope === "mine" ? { userId: req.user!.userId } : { status: "PENDING" },
    include: { user: { select: { username: true } }, reviewer: { select: { username: true } } }, orderBy: [{ createdAt: "desc" },{ id: "desc" }], take: 30, skip: (page-1)*30 }));
});
router.post("/", async (req, res) => {
  const data = input.parse(req.body), userId = req.user!.userId, completedOn = new Date(data.completedOn);
  const result = await serializable(async tx => {
    if (await tx.courseAttendance.findFirst({ where: { userId, title: { equals: data.title, mode: "insensitive" }, provider: { equals: data.provider, mode: "insensitive" }, completedOn, status: { not: "REJECTED" } } })) throw new OperationError(409, "Este curso ya fue declarado para esa fecha");
    const row = await tx.courseAttendance.create({ data: { ...data, completedOn, userId } });
    await tx.auditLog.create({ data: { actorUserId: userId, action: "COURSE_SUBMITTED", entityType: "CourseAttendance", entityId: row.id } });
    const reviewers = await tx.user.findMany({ where: { id: { not: userId }, isActive: true, deletedAt: null, isPendingApproval: false, OR: [{ role: { in: ["ADMIN","OPERATOR"] } }, { profile: { rank: { in: ["Administrador","Oficial","Sub oficial"] } } }] }, select: { id: true } });
    await notify(tx, reviewers.map(r => r.id), `Curso por revisar: ${row.title}`, "/courses");
    return row;
  });
  res.status(201).json(result);
});
router.post("/:id/review", authorize("ADMIN","OPERATOR"), async (req,res) => {
  const { status, note } = z.object({ status: z.enum(["APPROVED","REJECTED"]), note: z.string().trim().max(1000).default("") }).strict().parse(req.body);
  if (status === "REJECTED" && note.length < 5) throw new OperationError(400,"Indique el motivo del rechazo");
  const id = String(req.params.id), reviewerId = req.user!.userId;
  res.json(await serializable(async tx => {
    const row = await tx.courseAttendance.findUnique({ where: { id } });
    if (!row) throw new OperationError(404, "Curso no encontrado");
    if (row.userId === reviewerId) throw new OperationError(403, "No puede revisar su propio curso");
    if (!(await tx.courseAttendance.updateMany({ where: { id, status: "PENDING" }, data: { reviewerId, reviewedAt: new Date(), reviewNote: note || null, status } })).count) throw new OperationError(409,"Este curso ya fue revisado");
    await tx.auditLog.create({ data: { actorUserId: reviewerId, action: `COURSE_${status}`, entityType: "CourseAttendance", entityId: id, metadata: { note, userId: row.userId } } });
    await notify(tx,[row.userId],`Curso ${status === "APPROVED" ? "aprobado" : "rechazado"}: ${row.title}`, "/courses", note);
    return { status };
  }));
});
export default router;
