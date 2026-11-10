"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const audit_rules_1 = require("../utils/audit-rules");
const client_1 = require("@prisma/client");
const firefighter_ranks_1 = require("../utils/firefighter-ranks");
const readiness_service_1 = require("../modules/dashboard/readiness.service");
const incidents_service_1 = require("../modules/incidents/incidents.service");
const compliance_service_1 = require("../modules/compliance/compliance.service");
const shifts_rules_1 = require("../modules/shifts/shifts.rules");
const station_time_1 = require("../utils/station-time");
const air_rules_1 = require("../modules/air/air.rules");
const zod_1 = require("zod");
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
            user: {
                select: {
                    username: true,
                    isActive: true,
                    isPendingApproval: true,
                    deletedAt: true,
                },
            },
            station: { select: { name: true } },
        },
    });
    const byUser = new Map();
    for (const attendance of openAttendances) {
        pushGroup(byUser, attendance.userId, attendance);
        if (attendance.checkOutAt) {
            report("ATTENDANCE_OPEN_WITH_CHECKOUT", `Asistencia abierta con salida: ${attendance.user.username}`, attendance.id);
        }
        if (!attendance.checkInAt) {
            report("ATTENDANCE_OPEN_WITHOUT_CHECKIN", `Asistencia abierta sin ingreso: ${attendance.user.username}`, attendance.id);
        }
        if (attendance.checkInTrust === "REJECTED") {
            report("ATTENDANCE_OPEN_WITH_REJECTED_TRUST", `Asistencia abierta con validacion rechazada: ${attendance.user.username}`, attendance.id);
        }
        if (!attendance.user.isActive ||
            attendance.user.isPendingApproval ||
            attendance.user.deletedAt) {
            report("ATTENDANCE_OPEN_USER_NOT_ALLOWED", `Usuario no habilitado figura presente: ${attendance.user.username}`, attendance.id);
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
        const expected = shift.period === "DAY"
            ? { startTime: "08:00", endTime: "20:00" }
            : shift.period === "NIGHT"
                ? { startTime: "20:00", endTime: "08:00" }
                : null;
        if (expected && (shift.startTime !== expected.startTime || shift.endTime !== expected.endTime)) {
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
        if (dateKey(shift.date) >= dateKey(new Date()) &&
            shift.assignments.length === 0) {
            report("UPCOMING_SHIFT_WITHOUT_STAFF", `Guardia actual o futura sin personal: ${shift.shiftType}`, shift.id);
        }
    }
    for (let index = 0; index < shifts.length; index += 1) {
        const current = shifts[index];
        for (let nextIndex = index + 1; nextIndex < shifts.length; nextIndex += 1) {
            const next = shifts[nextIndex];
            if (next.date.getTime() - current.date.getTime() > DAY_MS)
                break;
            if (!(0, shifts_rules_1.shiftsOverlap)({ date: dateKey(current.date), startTime: current.startTime, endTime: current.endTime }, { date: dateKey(next.date), startTime: next.startTime, endTime: next.endTime })) {
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
            items: {
                include: {
                    inventoryItem: {
                        include: {
                            compartment: true,
                        },
                    },
                },
            },
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
        if (inspection.inspectionDate.getTime() > Date.now() + DAY_MS) {
            report("INSPECTION_DATE_IN_FUTURE", `Inspeccion con fecha futura: ${inspection.vehicle.asset.name}`, inspection.id);
        }
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
        for (const item of inspection.items) {
            if (item.inventoryItem.compartment.vehicleId !== inspection.vehicleId) {
                report("INSPECTION_ITEM_FROM_ANOTHER_VEHICLE", `Control de ${inspection.vehicle.asset.name} incluye un elemento de otro vehiculo`, item.id);
            }
            if (item.expectedQuantity < 1) {
                report("INSPECTION_ITEM_INVALID_QUANTITY", `Elemento controlado con cantidad invalida: ${item.inventoryItem.name}`, item.id);
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
    const incidentsByAlert = new Map();
    for (const incident of incidents) {
        if (incident.alertId) {
            pushGroup(incidentsByAlert, incident.alertId, incident);
        }
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
        if (incident.status === "OPEN" && incident.alert?.status === "RESOLVED") {
            report("INCIDENT_OPEN_WITH_RESOLVED_ALERT", `Incidente abierto vinculado a alerta resuelta: ${incident.title}`, incident.id);
        }
        for (const assignment of incident.assignments) {
            if (!assignment.user.isActive ||
                assignment.user.isPendingApproval ||
                assignment.user.deletedAt) {
                report("INCIDENT_ASSIGNMENT_USER_NOT_ALLOWED", `Usuario no habilitado asignado a incidente: ${assignment.user.username}`, incident.id);
            }
        }
    }
    for (const [alertId, linkedIncidents] of incidentsByAlert.entries()) {
        if (linkedIncidents.length > 1) {
            report("ALERT_WITH_MULTIPLE_INCIDENTS", `Alerta vinculada a ${linkedIncidents.length} incidentes`, alertId);
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
    const logs = await prisma.auditLog.findMany({
        include: {
            actor: true,
        },
    });
    for (const log of logs) {
        if (log.action.trim().length === 0 || log.entityType.trim().length === 0) {
            report("AUDIT_LOG_EMPTY_ACTION_OR_ENTITY", "Registro de auditoria sin accion o entidad", log.id);
        }
        if (!/^[A-Z0-9_]+$/.test(log.action)) {
            report("AUDIT_LOG_INVALID_ACTION_FORMAT", `Registro de auditoria con accion no normalizada: ${log.action}`, log.id);
        }
        if (log.entityType !== log.entityType.trim()) {
            report("AUDIT_LOG_ENTITY_TYPE_NOT_TRIMMED", `Registro de auditoria con entidad sin normalizar: ${log.entityType}`, log.id);
        }
        if (!log.actorUserId && (0, audit_rules_1.auditActorRequired)(log.action, log.entityType, log.metadata)) {
            report("AUDIT_LOG_MUTATION_WITHOUT_ACTOR", `Registro de auditoria operativo sin actor: ${log.action}`, log.id);
        }
        // Historical actions remain valid after the actor's account is deactivated.
        if (containsSensitiveMetadataKey(log.metadata)) {
            report("AUDIT_LOG_SENSITIVE_METADATA_KEY", `Registro de auditoria con clave sensible en metadata: ${log.action}`, log.id);
        }
    }
}
async function checkComplianceRecords() {
    checkPath();
    const records = await prisma.complianceRecord.findMany({
        where: { deletedAt: null },
        include: { user: true, asset: true },
    });
    for (const record of records) {
        const validUserSubject = record.subjectType === "USER" &&
            Boolean(record.userId) &&
            !record.assetId &&
            record.user?.isActive &&
            !record.user.isPendingApproval &&
            !record.user.deletedAt;
        const validAssetSubject = record.subjectType === "ASSET" &&
            Boolean(record.assetId) &&
            !record.userId &&
            record.asset &&
            !record.asset.deletedAt;
        if (!validUserSubject && !validAssetSubject) {
            report("COMPLIANCE_INVALID_SUBJECT", `Registro de cumplimiento con sujeto invalido: ${record.title}`, record.id);
        }
        if (record.warningDays < 0 || record.warningDays > 3650) {
            report("COMPLIANCE_INVALID_WARNING_DAYS", `Anticipacion invalida en: ${record.title}`, record.id);
        }
        if (record.issuedAt &&
            record.expiresAt &&
            record.expiresAt.getTime() < record.issuedAt.getTime()) {
            report("COMPLIANCE_INVALID_DATE_ORDER", `Vencimiento anterior a emision: ${record.title}`, record.id);
        }
    }
}
function checkOperationalReadinessRules() {
    const cases = [
        {
            name: "sin personal",
            expected: "NOT_READY",
            input: {
                presentCount: 0,
                commandPresentCount: 0,
                readyVehicleCount: 1,
                recommendedCrewSize: 3,
                activeShift: null,
            },
        },
        {
            name: "sin vehiculo listo",
            expected: "NOT_READY",
            input: {
                presentCount: 3,
                commandPresentCount: 1,
                readyVehicleCount: 0,
                recommendedCrewSize: 3,
                activeShift: { assignedCount: 3, presentAssignedCount: 3 },
            },
        },
        {
            name: "dotacion reducida",
            expected: "LIMITED",
            input: {
                presentCount: 2,
                commandPresentCount: 1,
                readyVehicleCount: 1,
                recommendedCrewSize: 3,
                activeShift: { assignedCount: 2, presentAssignedCount: 2 },
            },
        },
        {
            name: "guardia incompleta",
            expected: "LIMITED",
            input: {
                presentCount: 3,
                commandPresentCount: 1,
                readyVehicleCount: 1,
                recommendedCrewSize: 3,
                activeShift: { assignedCount: 4, presentAssignedCount: 3 },
            },
        },
        {
            name: "alistamiento completo",
            expected: "READY",
            input: {
                presentCount: 3,
                commandPresentCount: 1,
                readyVehicleCount: 1,
                recommendedCrewSize: 3,
                activeShift: { assignedCount: 3, presentAssignedCount: 3 },
            },
        },
    ];
    for (const testCase of cases) {
        checkPath();
        const result = (0, readiness_service_1.evaluateOperationalReadiness)(testCase.input);
        if (result.status !== testCase.expected) {
            report("OPERATIONAL_READINESS_RULE_MISMATCH", `La regla '${testCase.name}' devolvio ${result.status} y se esperaba ${testCase.expected}`);
        }
    }
}
function checkIncidentDispatchRules() {
    const baseUser = {
        isActive: true,
        isPendingApproval: false,
        deletedAt: null,
    };
    const cases = [
        {
            name: "asigna confirmados habilitados",
            expected: ["going-active"],
            responses: [
                { userId: "going-active", response: "GOING", user: baseUser },
                { userId: "not-going", response: "NOT_GOING", user: baseUser },
            ],
        },
        {
            name: "excluye usuarios inactivos",
            expected: [],
            responses: [
                {
                    userId: "inactive",
                    response: "GOING",
                    user: { ...baseUser, isActive: false },
                },
            ],
        },
        {
            name: "excluye usuarios pendientes y eliminados",
            expected: [],
            responses: [
                {
                    userId: "pending",
                    response: "GOING",
                    user: { ...baseUser, isPendingApproval: true },
                },
                {
                    userId: "deleted",
                    response: "GOING",
                    user: { ...baseUser, deletedAt: new Date() },
                },
            ],
        },
    ];
    for (const testCase of cases) {
        checkPath();
        const actual = (0, incidents_service_1.selectEligibleResponderIds)(testCase.responses);
        if (actual.join(",") !== testCase.expected.join(",")) {
            report("INCIDENT_DISPATCH_ASSIGNMENT_RULE_MISMATCH", `La regla '${testCase.name}' asigno [${actual.join(", ")}]`);
        }
    }
}
function checkComplianceRules() {
    const now = new Date("2026-08-26T12:00:00.000Z");
    const cases = [
        { name: "sin vencimiento", expiresAt: null, warningDays: 30, expected: "NO_EXPIRY" },
        { name: "vigente", expiresAt: new Date("2026-10-26T12:00:00.000Z"), warningDays: 30, expected: "VALID" },
        { name: "limite de aviso", expiresAt: new Date("2026-09-25T12:00:00.000Z"), warningDays: 30, expected: "DUE_SOON" },
        { name: "vencido", expiresAt: new Date("2026-08-25T12:00:00.000Z"), warningDays: 30, expected: "EXPIRED" },
    ];
    for (const testCase of cases) {
        checkPath();
        const actual = (0, compliance_service_1.evaluateComplianceStatus)(testCase.expiresAt, testCase.warningDays, now);
        if (actual.status !== testCase.expected) {
            report("COMPLIANCE_STATUS_RULE_MISMATCH", `La regla '${testCase.name}' devolvio ${actual.status} y se esperaba ${testCase.expected}`);
        }
    }
}
async function checkPersonalEquipment() {
    checkPath();
    const items = await prisma.personalEquipment.findMany({ include: {
            asset: { include: { maintenanceJobs: { where: { blocksOperation: true } } } },
            issues: { orderBy: { issuedAt: "desc" } }, checks: { orderBy: [{ checkedAt: "desc" }, { id: "desc" }], take: 1 },
        } });
    for (const item of items) {
        const open = item.issues.filter((issue) => !issue.returnedAt);
        if (item.asset.assetType !== "PPE")
            report("PPE_INVALID_ASSET_TYPE", `Tipo de activo incompatible: ${item.code}`, item.id);
        if (open.length > 1)
            report("PPE_MULTIPLE_HOLDERS", `Varias entregas activas: ${item.code}`, item.id);
        if (item.archivedAt && (open.length || item.asset.status !== "OUT_OF_SERVICE"))
            report("PPE_ARCHIVE_INCONSISTENT", `Baja con entrega o estado incompatible: ${item.code}`, item.id);
        for (const issue of item.issues) {
            if (issue.returnedAt && (issue.returnedAt < issue.issuedAt || !issue.receivedByUserId || !issue.returnCondition))
                report("PPE_RETURN_INCONSISTENT", `Devolucion inconsistente: ${item.code}`, issue.id);
        }
        if (!item.archivedAt && item.asset.status === "OPERATIONAL") {
            const check = item.checks[0];
            const lastReturn = item.issues.filter((issue) => issue.returnedAt).reduce((latest, issue) => Math.max(latest, issue.returnedAt.getTime()), 0);
            const lastMaintenance = item.asset.maintenanceJobs.reduce((latest, job) => Math.max(latest, job.resolvedAt?.getTime() || 0), 0);
            if (!check || check.condition !== "OK" || check.checkedAt.getTime() < Math.max(lastReturn, lastMaintenance))
                report("PPE_OPERATIONAL_WITHOUT_VALID_CHECK", `Falta revision posterior a devolucion o reparacion: ${item.code}`, item.id);
            if (item.asset.maintenanceJobs.some((job) => job.status === "OPEN" || job.status === "IN_PROGRESS"))
                report("PPE_BLOCKING_MAINTENANCE", `Elemento operativo con mantenimiento bloqueante: ${item.code}`, item.id);
        }
    }
    checkPath();
    const requests = await prisma.personalEquipmentRequest.findMany({ include: { fulfilledIssue: true } });
    for (const request of requests) {
        if (request.reviewedByUserId === request.userId)
            report("PPE_SELF_REVIEW", "Pedido revisado por su propio solicitante", request.id);
        if (request.reviewedAt && request.reviewedAt < request.createdAt)
            report("PPE_REQUEST_REVIEW_TIME", "Pedido revisado antes de su creacion", request.id);
        if (request.status === "FULFILLED" && (!request.fulfilledIssue || request.fulfilledIssue.userId !== request.userId || !request.fulfilledAt || !request.reviewedAt || request.fulfilledIssue.issuedAt < request.reviewedAt))
            report("PPE_REQUEST_FULFILLMENT", "Pedido entregado sin aprobacion previa o con destinatario incompatible", request.id);
    }
}
async function checkAirEquipment() {
    checkPath();
    const cylinders = await prisma.airCylinder.findMany({ include: { asset: true, vehicle: true, hydroTests: { take: 1, orderBy: [{ testedOn: "desc" }, { createdAt: "desc" }, { id: "desc" }] }, fillItems: { include: { fill: true } } } });
    for (const row of cylinders) {
        if (row.asset.assetType !== "PPE" || row.pressureBar !== null && (row.pressureBar < 0 || row.pressureBar > row.ratedPressureBar))
            report("AIR_CYLINDER_INVALID", "Tipo o presion de cilindro incompatible", row.id);
        if (row.retiredAt && row.asset.status !== "OUT_OF_SERVICE")
            report("AIR_CYLINDER_RETIRED_STATE", "Cilindro dado de baja con estado operativo", row.id);
        if (!row.retiredAt && row.vehicle && (row.vehicle.assetType !== "VEHICLE" || row.vehicle.deletedAt))
            report("AIR_CYLINDER_LOCATION_INVALID", "Ubicacion del cilindro no corresponde a un movil activo", row.id);
        if (!row.retiredAt && row.asset.status === "OPERATIONAL" && (!row.reviewedAt || !(0, air_rules_1.hydroCurrent)(row.hydroTests[0], (0, station_time_1.stationDate)())))
            report("AIR_CYLINDER_REVIEW_REQUIRED", "Cilindro operativo sin revision o con prueba vencida", row.id);
        const intervals = row.fillItems.map((item) => item.fill).sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
        for (let index = 1; index < intervals.length; index++)
            if (intervals[index].startedAt < intervals[index - 1].endedAt)
                report("AIR_CYLINDER_OVERLAPPING_FILLS", "Cargas solapadas para un mismo cilindro", row.id);
    }
    checkPath();
    const compSnapshot = zod_1.z.object({ maxPressureBar: zod_1.z.number().int().positive(), totalMinutesBefore: zod_1.z.number().int().min(0), filterBaselineMinutes: zod_1.z.number().int().min(0), filterLifeMinutes: zod_1.z.number().int().positive(), airQualityValidUntil: zod_1.z.string().datetime() });
    const tubeSnapshot = zod_1.z.object({ ratedPressureBar: zod_1.z.number().int().positive(), hydroValidUntil: zod_1.z.string().datetime() });
    const compressors = await prisma.airCompressor.findMany({ include: { asset: true, fills: { include: { items: true, helpers: true }, orderBy: { startedAt: "asc" } } } });
    for (const row of compressors) {
        if (row.filterBaselineMinutes > row.totalRunMinutes || row.filterBaselineMinutes < 0 || row.filterLifeMinutes < 1)
            report("AIR_COMPRESSOR_COUNTER_INVALID", "Contador o limite de filtro incoherente", row.id);
        if (row.retiredAt && row.asset.status !== "OUT_OF_SERVICE")
            report("AIR_COMPRESSOR_RETIRED_STATE", "Compresor dado de baja con estado operativo", row.id);
        if (!row.retiredAt && row.asset.status === "OPERATIONAL" && (!row.reviewedAt || !row.airQualityReference || !row.airQualityValidUntil || row.airQualityValidUntil.toISOString().slice(0, 10) < (0, station_time_1.stationDate)() || !(0, air_rules_1.filterRemaining)(row.totalRunMinutes, row.filterBaselineMinutes, row.filterLifeMinutes)))
            report("AIR_COMPRESSOR_REVIEW_REQUIRED", "Compresor operativo sin controles vigentes o con filtro agotado", row.id);
        for (const [index, fill] of row.fills.entries()) {
            if (index && fill.startedAt < row.fills[index - 1].endedAt)
                report("AIR_COMPRESSOR_OVERLAP", "Intervalos de compresor solapados", fill.id);
            if (Math.ceil((fill.endedAt.getTime() - fill.startedAt.getTime()) / 60000) !== fill.runMinutes || fill.runMinutes < 1 || fill.endedAt > new Date())
                report("AIR_FILL_TIME_INVALID", "Intervalo o minutos de carga invalidos", fill.id);
            if (!fill.items.length || fill.helpers.some((helper) => helper.userId === fill.operatorUserId))
                report("AIR_FILL_PARTICIPANTS_INVALID", "Carga sin cilindros o con encargado repetido como ayudante", fill.id);
            const snapshot = compSnapshot.safeParse(fill.compressorSnapshot);
            if (!snapshot.success) {
                report("AIR_FILL_SNAPSHOT_INVALID", "Falta instantanea valida del compresor", fill.id);
                continue;
            }
            const state = snapshot.data;
            if (state.totalMinutesBefore + fill.runMinutes > row.totalRunMinutes || fill.runMinutes > (0, air_rules_1.filterRemaining)(state.totalMinutesBefore, state.filterBaselineMinutes, state.filterLifeMinutes) || state.airQualityValidUntil.slice(0, 10) < (0, station_time_1.stationDate)(fill.endedAt))
                report("AIR_FILL_FILTER_INVALID", "Carga incompatible con horas o vigencia documentada", fill.id);
            for (const item of fill.items) {
                const tube = tubeSnapshot.safeParse(item.cylinderSnapshot);
                if (!tube.success || item.pressureBar > tube.data.ratedPressureBar || item.pressureBar > state.maxPressureBar || tube.data.hydroValidUntil.slice(0, 10) < (0, station_time_1.stationDate)(fill.endedAt))
                    report("AIR_FILL_PRESSURE_INVALID", "Presion o vencimiento incompatible con la instantanea del cilindro", fill.id);
            }
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
    await checkComplianceRecords();
    await checkPersonalEquipment();
    await checkAirEquipment();
    checkComplianceRules();
    checkIncidentDispatchRules();
    checkOperationalReadinessRules();
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
