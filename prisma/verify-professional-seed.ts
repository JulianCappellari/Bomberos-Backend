import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { PrismaClient } from "@prisma/client";
import { messageFingerprint } from "../src/utils/message-fingerprint";
import { policySchema } from "../src/modules/ranking/ranking.rules";
import { shiftInterval } from "../src/modules/shifts/shifts.rules";
import { effectiveAccessRole } from "../src/utils/firefighter-ranks";

const id = (key: string) => `demo_v2_professional_${key}`;
export async function verifyProfessionalSeed(client: PrismaClient) {
  const claims = await client.expenseClaim.findMany({ include: { payments: true, approvals: true } });
  for (const claim of claims) {
    assert(claim.receiptBytes && claim.receiptSha256, `${claim.title}: falta comprobante`);
    assert.equal(createHash("sha256").update(claim.receiptBytes).digest("hex"), claim.receiptSha256);
    const photo = await sharp(claim.receiptBytes).metadata();
    assert.equal(photo.format, "jpeg"); assert.equal(photo.exif, undefined);
    assert(claim.receiptBytes.length <= 250000);
    assert(claim.approvals.every(approval => approval.createdAt >= claim.createdAt));
    for (const payment of claim.payments) {
      assert(payment.createdAt >= claim.createdAt);
      assert(!payment.reversedAt || payment.reversedAt >= payment.createdAt);
    }
  }
  assert.equal(new Set(claims.map(c => c.receiptSha256)).size, claims.length, "Cada comprobante corresponde a un gasto distinto");
  for (const [key, expected] of [["paid", 0], ["reversed", 295000]] as const) {
    const claim = claims.find(c => c.id === id(`expense_${key}`))!;
    const debt = claim.amountCents - claim.payments.filter(p => !p.reversedAt).reduce((n, p) => n + p.amountCents, 0);
    assert.equal(debt, expected, "La reversion reabre la deuda; no debe ocultarse como un pago valido");
  }

  const transfers = await client.workTaskTransfer.findMany({ include: { task: { include: { members: true } } } });
  for (const state of ["PENDING", "ACCEPTED", "REJECTED", "CANCELLED"]) assert(transfers.some(t => t.status === state));
  for (const row of transfers) {
    const memberIds = row.task.members.map(m => m.userId);
    if (row.status === "ACCEPTED") { assert(memberIds.includes(row.toUserId)); assert(!memberIds.includes(row.fromUserId)); }
    else assert(memberIds.includes(row.fromUserId));
    assert(row.fromUserId !== row.toUserId);
    assert(row.status === "PENDING" ? row.resolvedAt === null : row.resolvedAt! >= row.createdAt);
  }
  const reclaimed = await client.workTask.findUniqueOrThrow({ where: { id: id("task_declined_reclaimed") }, include: { events: true, members: true } });
  assert(reclaimed.members.some(m => m.userId === "demo_v2_mateo" && m.declinedAt === null));
  assert(reclaimed.events.some(e => e.action === "DECLINE" && e.actorUserId === "demo_v2_mateo"));
  assert(reclaimed.events.some(e => e.action === "CLAIMED"));
  const verified = await client.workTask.findUniqueOrThrow({ where: { id: id("task_subofficer_verified") }, include: { reviewedBy: true, members: true } });
  assert(verified.status === "VERIFIED" && verified.officerApproved && !verified.requiresPresence);
  assert.equal(verified.reviewedBy?.role, "OPERATOR");
  assert(!verified.members.some(m => m.userId === verified.reviewedByUserId));
  for (const attendance of await client.attendance.findMany({ where: { id: { startsWith: "demo_v2_q_" } } })) {
    if (attendance.checkInQrId && !attendance.checkInQrId.startsWith("manual:")) {
      const qr = await client.qrChallenge.findUniqueOrThrow({ where: { id: attendance.checkInQrId } });
      assert(attendance.checkInAt! >= qr.createdAt && attendance.checkInAt! <= qr.expiresAt);
    }
    if (attendance.discardedAt) assert.equal(attendance.workedMinutes, 0);
  }
  const message = await client.chatMessage.findUniqueOrThrow({ where: { id: id("message_edited") }, include: { acknowledgements: true } });
  const fingerprint = messageFingerprint(message);
  assert.equal(message.acknowledgements.filter(a => a.contentHash === fingerprint).length, 1);
  assert.equal(message.acknowledgements.filter(a => a.contentHash !== fingerprint).length, 1);
  assert.equal(message.acknowledgements.find(a => a.contentHash !== fingerprint)?.userId, "demo_v2_bombero");
  for (const category of ["NOVELTY", "THIRD_PARTY", "CORRECTION", "DAMAGE"]) {
    const annex = await client.incidentNotebookEntry.findUniqueOrThrow({ where: { id: id(`annex_${category}`) }, include: { incident: true } });
    assert(annex.incident.status === "CLOSED" && annex.occurredAt > annex.incident.closedAt!);
  }
  policySchema.parse((await client.rankingPolicy.findUniqueOrThrow({ where: { id: "main" } })).config);
  assert.equal(await client.rankingTemplate.count({ where: { id: { startsWith: id("ranking_template_") }, active: true } }), 3);
  assert.equal(await client.rankingTemplate.count({ where: { id: { startsWith: id("ranking_template_") }, active: false } }), 1);
  assert((await client.user.findUniqueOrThrow({ where: { username: "demo.mateo" } })).guardEligible);
  const absences = await client.emergencyAvailability.findMany({ where: { cancelledAt: null } });
  for (const shift of await client.shift.findMany({ include: { assignments: true, createdBy: { include: { profile: true } } } })) {
    assert(["ADMIN", "OPERATOR"].includes(effectiveAccessRole(shift.createdBy.role, shift.createdBy.profile?.rank)), "Solo jefatura crea la agenda de guardias");
    const interval = shiftInterval(shift.date.toISOString().slice(0, 10), shift.startTime, shift.endTime);
    for (const assignment of shift.assignments) assert(!absences.some(a => a.userId === assignment.userId && +a.startsAt < interval.end && (!a.endsAt || +a.endsAt > interval.start)), "Guardia asignada durante ausencia programada");
  }
  for (const key of ["fire", "rescue", "accident", "ready"]) {
    const incident = await client.incident.findUniqueOrThrow({ where: { id: `demo_v2_sheet_${key}` }, include: {
      sheet: true, alert: { include: { originNotice: true, responses: true } }, movements: { include: { crew: true, departure: true } }, serviceParticipations: true,
    } });
    assert(incident.sheet && incident.alert?.originNotice);
    assert(incident.sheet.callerName && incident.sheet.callerPhone && incident.sheet.notes.length > 100);
    assert.equal(incident.sheet.baseUserIds.length, 1);
    assert(Array.isArray(incident.sheet.materials) && incident.sheet.materials.length >= 2);
    assert(incident.alert.originNotice.receivedAt <= incident.alert.createdAt && incident.alert.createdAt <= incident.occurredAt);
    assert.equal(incident.movements.length, 1);
    const movement = incident.movements[0]!;
    assert(movement.departure && movement.departedAt < movement.arrivedAt! && movement.arrivedAt! < movement.returnedAt!);
    assert(movement.crew.some(c => c.userId === movement.driverUserId) && movement.crew.some(c => c.userId === movement.leaderUserId));
    assert(!incident.serviceParticipations.some(p => p.userId === incident.sheet!.authorId), "Escribir una planilla no acredita presencia ni servicio al autor");
    assert.equal(incident.alert.responses.find(r => r.userId === "demo_v2_oficial")?.response, "NOT_GOING");
    if (key === "ready") { assert.equal(incident.status, "OPEN"); assert.equal(incident.sheet.finalizedAt, null); }
    else {
      assert.equal(incident.status, "CLOSED"); assert.equal(+incident.sheet.finalizedAt!, +incident.closedAt!);
      const frozen = incident.sheet.finalContext as { incident: { id: string; status: string; movements: unknown[] }; baseCandidates: Array<{ id: string }> };
      assert.equal(frozen.incident.id, incident.id); assert.equal(frozen.incident.status, "CLOSED"); assert.equal(frozen.incident.movements.length, 1);
      assert(frozen.baseCandidates.some(p => p.id === incident.sheet!.baseUserIds[0]));
    }
  }
  console.log("Seed profesional: comprobantes privados, saldos y reversiones, transferencias, aval suboficial, QR temporal, acuse antiguo y anexos verificados.");
}
