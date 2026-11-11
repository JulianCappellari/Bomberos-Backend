"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.audienceLabels = exports.CHAT_AUDIENCES = void 0;
exports.audiencesOf = audiencesOf;
exports.visibleAudiences = visibleAudiences;
exports.audienceMemberIds = audienceMemberIds;
exports.assertCanSendTo = assertCanSendTo;
const firefighter_ranks_1 = require("../../utils/firefighter-ranks");
const station_time_1 = require("../../utils/station-time");
const operations_schemas_1 = require("../operations/operations.schemas");
// 25: mensajes dirigidos a un grupo. Todo el personal, jefatura, choferes habilitados,
// la guardia del dia o la comision directiva.
exports.CHAT_AUDIENCES = ["ALL", "COMMAND", "DRIVERS", "GUARD", "BOARD"];
exports.audienceLabels = { ALL: "Todo el personal", COMMAND: "Jefatura", DRIVERS: "Choferes habilitados", GUARD: "Guardia de hoy", BOARD: "Comisión directiva" };
const isCommand = (rank) => ["oficial", "suboficial", "administrador"].includes((0, firefighter_ranks_1.normalizeRank)(rank).replace(/\s/g, ""));
async function todayGuardIds(db) {
    const today = new Date((0, station_time_1.stationDate)());
    const rows = await db.shiftAssignment.findMany({ where: { shift: { date: today } }, select: { userId: true } });
    return new Set(rows.map((row) => row.userId));
}
async function driverIds(db) {
    const rows = await db.vehicleDriverAuthorization.findMany({ where: { validUntil: { gte: new Date((0, station_time_1.stationDate)()) } }, select: { userId: true } });
    return new Set(rows.map((row) => row.userId));
}
/** Grupos a los que pertenece una persona (siempre incluye ALL). */
async function audiencesOf(db, userId) {
    const user = await db.user.findUnique({ where: { id: userId }, select: { profile: { select: { rank: true } } } });
    const rank = user?.profile?.rank;
    const result = ["ALL"];
    if (isCommand(rank))
        result.push("COMMAND");
    if ((0, firefighter_ranks_1.normalizeRank)(rank) === "comision directiva")
        result.push("BOARD");
    if ((await driverIds(db)).has(userId))
        result.push("DRIVERS");
    if ((await todayGuardIds(db)).has(userId))
        result.push("GUARD");
    return result;
}
/** Jefatura ve todos los grupos para poder moderar; el resto, solo los propios. */
async function visibleAudiences(db, userId) {
    const own = await audiencesOf(db, userId);
    return own.includes("COMMAND") ? [...exports.CHAT_AUDIENCES] : own;
}
/** Destinatarios de un mensaje: quienes deben leerlo y confirmar. */
async function audienceMemberIds(db, audience) {
    const people = await db.user.findMany({ where: { isActive: true, isPendingApproval: false, deletedAt: null }, select: { id: true, profile: { select: { rank: true } } } });
    if (audience === "ALL")
        return people.map((p) => p.id);
    if (audience === "COMMAND")
        return people.filter((p) => isCommand(p.profile?.rank)).map((p) => p.id);
    if (audience === "BOARD")
        return people.filter((p) => (0, firefighter_ranks_1.normalizeRank)(p.profile?.rank) === "comision directiva").map((p) => p.id);
    const set = audience === "DRIVERS" ? await driverIds(db) : await todayGuardIds(db);
    return people.filter((p) => set.has(p.id)).map((p) => p.id);
}
/** Para enviar a un grupo hay que integrarlo, salvo jefatura que puede escribir a cualquiera. */
async function assertCanSendTo(db, userId, audience) {
    const own = await audiencesOf(db, userId);
    if (!own.includes(audience) && !own.includes("COMMAND"))
        throw new operations_schemas_1.OperationError(403, `Solo puede escribir al grupo "${exports.audienceLabels[audience]}" si lo integra`);
}
