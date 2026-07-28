"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const client_1 = require("@prisma/client");
const firefighter_ranks_1 = require("../utils/firefighter-ranks");
const prisma = new client_1.PrismaClient();
const VEHICLE_CONTROL_INTERVAL_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;
const violations = [];
let checkedPaths = 0;
function checkPath() {
    checkedPaths += 1;
}
function report(code, message, entityId) {
    violations.push({ code, message, entityId });
}
function dateKey(value) {
    return value.toISOString().slice(0, 10);
}
function timeToMinutes(value) {
    const [hours, minutes] = value.split(":").map(Number);
    return hours * 60 + minutes;
}
function rangesOverlap(startA, endA, startB, endB) {
    return timeToMinutes(startA) < timeToMinutes(endB) &&
        timeToMinutes(startB) < timeToMinutes(endA);
}
function pushGroup(groups, key, value) {
    groups.set(key, [...(groups.get(key) || []), value]);
}
function containsSensitiveMetadataKey(value) {
    if (!value || typeof value !== "object")
        return false;
    for (const [key, nestedValue] of Object.entries(value)) {
        const normalizedKey = key.toLowerCase();
        if (normalizedKey.includes("password") ||
            normalizedKey.includes("token") ||
            normalizedKey.includes("secret")) {
            return true;
        }
        if (containsSensitiveMetadataKey(nestedValue))
            return true;
    }
    return false;
}
async function checkUsers() {
    checkPath();
    const activeUsersWithoutProfile = await prisma.user.findMany({
        where: {
            deletedAt: null,
            isActive: true,
            isPendingApproval: false,
            profile: null,
        },
        select: {
            id: true,
            username: true,
        },
    });
    for (const user of activeUsersWithoutProfile) {
        report("USER_ACTIVE_WITHOUT_PROFILE", `Usuario activo sin perfil: ${user.username}`, user.id);
    }
    const usersWithProfiles = await prisma.user.findMany({
        where: {
            deletedAt: null,
        },
        include: {
            profile: true,
        },
    });
    for (const user of usersWithProfiles) {
        if (user.profile && !(0, firefighter_ranks_1.isAllowedFirefighterRank)(user.profile.rank)) {
            report("USER_INVALID_RANK", `Cargo no permitido en perfil: ${user.username} (${user.profile.rank})`, user.id);
        }
    }
}
async function checkAttendance() {
    checkPath();
    const openAttendances = await prisma.attendance.findMany({
        where: { status: "OPEN" },
        include: {
            user: { select: { username: true } },
            station: { select: { name: true } },
        },
    });
    const byUser = new Map();
    for (const attendance of openAttendances) {
        pushGroup(byUser, attendance.userId, attendance);
        if (attendance.checkOutAt) {
            report("ATTENDANCE_OPEN_WITH_CHECKOUT", `Asistencia abierta con salida: ${attendance.user.username}`, attendance.id);
        }
    }
    for (const [userId, items] of byUser.entries()) {
        if (items.length > 1) {
            report("ATTENDANCE_MULTIPLE_OPEN", `Usuario con ${items.length} asistencias abiertas: ${items[0].user.username}`, userId);
        }
    }
    checkPath();
    const closedAttendances = await prisma.attendance.findMany({
        where: { status: "CLOSED" },
        include: {
            user: { select: { username: true } },
        },
    });
    for (const attendance of closedAttendances) {
        if (!attendance.checkInAt || !attendance.checkOutAt) {
            report("ATTENDANCE_CLOSED_MISSING_DATES", `Asistencia cerrada sin fechas completas: ${attendance.user.username}`, attendance.id);
            continue;
        }
        if (attendance.workedMinutes === null ||
            attendance.workedMinutes < 0 ||
            attendance.checkOutAt.getTime() < attendance.checkInAt.getTime()) {
            report("ATTENDANCE_INVALID_WORKED_TIME", `Asistencia cerrada con tiempo invalido: ${attendance.user.username}`, attendance.id);
        }
    }
}
async function checkShifts() {
    checkPath();
    const shifts = await prisma.shift.findMany({
        include: {
            assignments: {
                include: {
                    user: {
                        include: {
                            profile: true,
                        },
                    },
                },
            },
        },
        orderBy: [{ date: "asc" }, { startTime: "asc" }],
    });
    for (const shift of shifts) {
        if (timeToMinutes(shift.endTime) <= timeToMinutes(shift.startTime)) {
            report("SHIFT_INVALID_TIME_RANGE", `Guardia con horario invalido: ${shift.shiftType}`, shift.id);
        }
        const seenUsers = new Set();
        for (const assignment of shift.assignments) {
            if (!assignment.user.isActive ||
                assignment.user.isPendingApproval ||
                assignment.user.deletedAt) {
                report("SHIFT_ASSIGNMENT_USER_NOT_ALLOWED", `Usuario no habilitado asignado a guardia: ${assignment.user.username}`, shift.id);
            }
            if (seenUsers.has(assignment.userId)) {
                report("SHIFT_DUPLICATED_USER", `Usuario duplicado en guardia: ${assignment.user.username}`, shift.id);
            }
            seenUsers.add(assignment.userId);
        }
    }
    for (let index = 0; index < shifts.length; index += 1) {
        const current = shifts[index];
        for (let nextIndex = index + 1; nextIndex < shifts.length; nextIndex += 1) {
            const next = shifts[nextIndex];
            if (dateKey(current.date) !== dateKey(next.date))
                continue;
            if (!rangesOverlap(current.startTime, current.endTime, next.startTime, next.endTime)) {
                continue;
            }
            const currentUsers = new Set(current.assignments.map((assignment) => assignment.userId));
            for (const assignment of next.assignments) {
                if (currentUsers.has(assignment.userId)) {
                    report("SHIFT_OVERLAPPING_ASSIGNMENT", `Solape de guardias para ${assignment.user.profile?.fullName || assignment.user.username} el ${dateKey(current.date)}`, `${current.id},${next.id}`);
                }
            }
        }
    }
}
async function checkInspections() {
    checkPath();
    const inspections = await prisma.inspection.findMany({
        include: {
            items: true,
            responsibles: {
                include: {
                    user: true,
                },
            },
            vehicle: {
                include: {
                    asset: true,
                },
            },
        },
    });
    for (const inspection of inspections) {
        const summaryOk = inspection.items.filter((item) => item.result === "OK").length;
        const summaryMissing = inspection.items.filter((item) => item.result === "MISSING").length;
        const summaryDamaged = inspection.items.filter((item) => item.result === "DAMAGED").length;
        const summaryUnchecked = inspection.items.filter((item) => item.result === "UNCHECKED").length;
        if (summaryOk !== inspection.summaryOk ||
            summaryMissing !== inspection.summaryMissing ||
            summaryDamaged !== inspection.summaryDamaged ||
            summaryUnchecked !== inspection.summaryUnchecked) {
            report("INSPECTION_SUMMARY_MISMATCH", `Resumen inconsistente en inspeccion de ${inspection.vehicle.asset.name}`, inspection.id);
        }
        if (inspection.responsibles.length === 0) {
            report("INSPECTION_WITHOUT_RESPONSIBLES", `Inspeccion sin responsables: ${inspection.vehicle.asset.name}`, inspection.id);
        }
        for (const responsible of inspection.responsibles) {
            if (!responsible.user.isActive ||
                responsible.user.isPendingApproval ||
                responsible.user.deletedAt) {
                report("INSPECTION_RESPONSIBLE_NOT_ALLOWED", `Responsable no habilitado en inspeccion: ${responsible.user.username}`, inspection.id);
            }
        }
    }
}
async function checkAlertsAndIncidents() {
    checkPath();
    const alerts = await prisma.alert.findMany({
        include: {
            responses: {
                include: {
                    user: true,
                },
            },
        },
    });
    for (const alert of alerts) {
        if (alert.status === "ACTIVE" && (alert.resolvedAt || alert.resolvedByUserId)) {
            report("ALERT_ACTIVE_WITH_RESOLUTION", `Alerta activa con datos de resolucion: ${alert.location}`, alert.id);
        }
        if (alert.status === "RESOLVED" &&
            (!alert.resolvedAt || !alert.resolvedByUserId)) {
            report("ALERT_RESOLVED_WITHOUT_RESOLUTION", `Alerta resuelta sin responsable o fecha: ${alert.location}`, alert.id);
        }
        for (const response of alert.responses) {
            if (!response.user.isActive ||
                response.user.isPendingApproval ||
                response.user.deletedAt) {
                report("ALERT_RESPONSE_USER_NOT_ALLOWED", `Respuesta de alerta con usuario no habilitado: ${response.user.username}`, alert.id);
            }
        }
    }
    checkPath();
    const incidents = await prisma.incident.findMany({
        include: {
            alert: true,
            assignments: {
                include: {
                    user: true,
                },
            },
        },
    });
    for (const incident of incidents) {
        if (incident.status === "CLOSED" &&
            (!incident.closedAt || !incident.closedByUserId)) {
            report("INCIDENT_CLOSED_WITHOUT_CLOSURE", `Incidente cerrado sin cierre completo: ${incident.title}`, incident.id);
        }
        if (incident.status === "OPEN" && (incident.closedAt || incident.closedByUserId)) {
            report("INCIDENT_OPEN_WITH_CLOSURE", `Incidente abierto con datos de cierre: ${incident.title}`, incident.id);
        }
        if (incident.alert && incident.alert.type !== incident.type) {
            report("INCIDENT_ALERT_TYPE_MISMATCH", `Incidente con tipo distinto a la alerta: ${incident.title}`, incident.id);
        }
        if (incident.status === "CLOSED" && incident.alert?.status === "ACTIVE") {
            report("INCIDENT_CLOSED_WITH_ACTIVE_ALERT", `Incidente cerrado con alerta activa: ${incident.title}`, incident.id);
        }
        if (incident.status === "OPEN" && incident.alert?.status === "CANCELLED") {
            report("INCIDENT_OPEN_WITH_CANCELLED_ALERT", `Incidente abierto vinculado a alerta cancelada: ${incident.title}`, incident.id);
        }
        for (const assignment of incident.assignments) {
            if (!assignment.user.isActive ||
                assignment.user.isPendingApproval ||
                assignment.user.deletedAt) {
                report("INCIDENT_ASSIGNMENT_USER_NOT_ALLOWED", `Usuario no habilitado asignado a incidente: ${assignment.user.username}`, incident.id);
            }
        }
    }
}
async function checkChat() {
    checkPath();
    const messages = await prisma.chatMessage.findMany({
        select: {
            id: true,
            authorUserId: true,
            body: true,
            deletedAt: true,
            isPinned: true,
        },
    });
    for (const message of messages) {
        if (message.deletedAt && message.isPinned) {
            report("CHAT_DELETED_PINNED", `Mensaje borrado sigue fijado: ${message.body.slice(0, 40)}`, message.id);
        }
        if (!message.deletedAt && message.body.trim().length === 0) {
            report("CHAT_EMPTY_ACTIVE_MESSAGE", "Mensaje activo vacio", message.id);
        }
    }
    const messagesById = new Map(messages.map((message) => [message.id, message]));
    const chatAuditLogs = await prisma.auditLog.findMany({
        where: {
            action: {
                in: [
                    "CHAT_MESSAGE_UPDATED",
                    "CHAT_MESSAGE_DELETED",
                    "CHAT_MESSAGE_PINNED",
                    "CHAT_MESSAGE_UNPINNED",
                ],
            },
        },
        include: {
            actor: {
                include: {
                    profile: true,
                },
            },
        },
    });
    for (const log of chatAuditLogs) {
        const message = messagesById.get(log.entityId);
        if (log.action === "CHAT_MESSAGE_UPDATED" &&
            message &&
            log.actorUserId !== message.authorUserId) {
            report("CHAT_EDITED_BY_NON_AUTHOR", "Mensaje editado por alguien distinto al autor", log.id);
        }
        if ([
            "CHAT_MESSAGE_DELETED",
            "CHAT_MESSAGE_PINNED",
            "CHAT_MESSAGE_UNPINNED",
        ].includes(log.action) &&
            !(0, firefighter_ranks_1.isCommandRank)(log.actor?.profile?.rank)) {
            report("CHAT_MODERATED_BY_NON_COMMAND_RANK", `Moderacion de chat sin cargo autorizado: ${log.actor?.username ?? "Sistema"}`, log.id);
        }
    }
}
async function checkQrAndDevices() {
    checkPath();
    const challenges = await prisma.qrChallenge.findMany({
        include: {
            station: true,
        },
    });
    for (const challenge of challenges) {
        if (challenge.expiresAt.getTime() <= challenge.createdAt.getTime()) {
            report("QR_INVALID_EXPIRATION", `QR con expiracion anterior a creacion: ${challenge.station.name}`, challenge.id);
        }
        if (challenge.revokedAt &&
            challenge.revokedAt.getTime() < challenge.createdAt.getTime()) {
            report("QR_REVOKED_BEFORE_CREATED", `QR revocado antes de crearse: ${challenge.station.name}`, challenge.id);
        }
        if (challenge.consumedCount < 0) {
            report("QR_NEGATIVE_CONSUMPTION", `QR con consumo negativo: ${challenge.station.name}`, challenge.id);
        }
    }
    checkPath();
    const devices = await prisma.trustedDevice.findMany({
        include: {
            station: true,
        },
    });
    for (const device of devices) {
        if (device.fingerprint.trim().length < 6) {
            report("TRUSTED_DEVICE_WEAK_FINGERPRINT", `Dispositivo confiable con fingerprint debil: ${device.name}`, device.id);
        }
        if (device.isActive && device.name.trim().length === 0) {
            report("TRUSTED_DEVICE_ACTIVE_WITHOUT_NAME", `Dispositivo activo sin nombre en ${device.station.name}`, device.id);
        }
    }
}
async function checkInventory() {
    checkPath();
    const items = await prisma.vehicleInventoryItem.findMany({
        include: {
            compartment: {
                include: {
                    vehicle: {
                        include: {
                            asset: true,
                        },
                    },
                },
            },
        },
    });
    const itemGroups = new Map();
    for (const item of items) {
        if (item.expectedQuantity < 1) {
            report("INVENTORY_INVALID_QUANTITY", `Cantidad esperada invalida: ${item.name}`, item.id);
        }
        const key = `${item.compartmentId}:${item.name.trim().toLowerCase()}`;
        pushGroup(itemGroups, key, item);
    }
    for (const [, group] of itemGroups.entries()) {
        if (group.length > 1) {
            report("INVENTORY_DUPLICATED_ITEM_NAME", `Item duplicado en ${group[0].compartment.name}: ${group[0].name}`, group.map((item) => item.id).join(","));
        }
    }
    checkPath();
    const vehicles = await prisma.vehicle.findMany({
        include: {
            asset: true,
            compartments: true,
            inspections: {
                take: 1,
                orderBy: [{ inspectionDate: "desc" }, { createdAt: "desc" }],
            },
        },
    });
    const staleControlLimit = new Date(Date.now() - VEHICLE_CONTROL_INTERVAL_DAYS * DAY_MS);
    for (const vehicle of vehicles) {
        if (vehicle.compartments.length === 0) {
            report("VEHICLE_WITHOUT_COMPARTMENTS", `Vehiculo sin compartimentos: ${vehicle.asset.name}`, vehicle.id);
        }
        const latestInspection = vehicle.inspections[0] ?? null;
        if (!latestInspection) {
            report("VEHICLE_WITHOUT_CONTROL", `Vehiculo sin control registrado: ${vehicle.asset.name}`, vehicle.id);
            continue;
        }
        if (!vehicle.asset.lastCheckDate ||
            vehicle.asset.lastCheckDate.getTime() !==
                latestInspection.inspectionDate.getTime()) {
            report("VEHICLE_LAST_CHECK_OUT_OF_SYNC", `Fecha de ultimo control desincronizada: ${vehicle.asset.name}`, vehicle.id);
        }
        const latestControlHasIssues = latestInspection.summaryMissing > 0 ||
            latestInspection.summaryDamaged > 0 ||
            latestInspection.summaryUnchecked > 0;
        if (vehicle.asset.status === "OPERATIONAL" && latestControlHasIssues) {
            report("VEHICLE_OPERATIONAL_WITH_FAILED_CONTROL", `Vehiculo operativo con ultimo control observado: ${vehicle.asset.name}`, vehicle.id);
        }
        if (vehicle.asset.status === "OPERATIONAL" &&
            latestInspection.inspectionDate.getTime() < staleControlLimit.getTime()) {
            report("VEHICLE_OPERATIONAL_CONTROL_OVERDUE", `Vehiculo operativo con control vencido: ${vehicle.asset.name}`, vehicle.id);
        }
    }
}
async function checkAuditLogs() {
    checkPath();
    const logs = await prisma.auditLog.findMany();
    for (const log of logs) {
        if (log.action.trim().length === 0 || log.entityType.trim().length === 0) {
            report("AUDIT_LOG_EMPTY_ACTION_OR_ENTITY", "Registro de auditoria sin accion o entidad", log.id);
        }
        if (containsSensitiveMetadataKey(log.metadata)) {
            report("AUDIT_LOG_SENSITIVE_METADATA_KEY", `Registro de auditoria con clave sensible en metadata: ${log.action}`, log.id);
        }
    }
}
async function main() {
    await checkUsers();
    await checkAttendance();
    await checkShifts();
    await checkInspections();
    await checkAlertsAndIncidents();
    await checkChat();
    await checkQrAndDevices();
    await checkInventory();
    await checkAuditLogs();
    if (violations.length > 0) {
        console.error(`Logic check FAILED: ${violations.length} violaciones en ${checkedPaths} caminos.`);
        for (const violation of violations) {
            console.error(`- [${violation.code}] ${violation.message}${violation.entityId ? ` (${violation.entityId})` : ""}`);
        }
        process.exitCode = 1;
        return;
    }
    console.log(`Logic check OK: ${checkedPaths} caminos sin violaciones.`);
}
main()
    .catch((error) => {
    console.error("Logic check error:", error);
    process.exitCode = 1;
})
    .finally(async () => {
    await prisma.$disconnect();
});
