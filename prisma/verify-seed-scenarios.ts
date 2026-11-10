import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { messageFingerprint } from "../src/utils/message-fingerprint";
import { shiftInterval } from "../src/modules/shifts/shifts.rules";

export async function verifySeedScenarios(client: PrismaClient) {
  const people = await client.user.findMany({ include: { profile: true } });
  for (const rank of ["Administrador", "Oficial", "Sub oficial", "Bombero", "Guardia", "Comision directiva", "Aspirante mayor", "Aspirante menor"]) assert(people.some((u) => u.profile?.rank.toLowerCase() === rank.toLowerCase()), `Falta cargo ${rank}`);
  assert(people.some((u) => !u.isActive)); assert(people.some((u) => u.isPendingApproval)); assert(people.some((u) => u.mustChangePassword));
  assert(people.every((u) => !u.profile?.bloodType || ["O+", "O-", "A+", "A-", "B+", "B-", "AB+", "AB-"].includes(u.profile.bloodType)));
  assert.equal(await client.authSession.count(), 0); assert.equal(await client.trustedDevice.count(), 0);
  assert.equal(await client.qrChallenge.count({ where: { revokedAt: null, expiresAt: { gt: new Date() } } }), 0);
  const qrAttendance = await client.attendance.findUniqueOrThrow({ where: { id: "demo_v2_present_matias" } });
  const qr = await client.qrChallenge.findUniqueOrThrow({ where: { id: qrAttendance.checkInQrId! } });
  assert(qrAttendance.checkInAt! >= qr.createdAt && qrAttendance.checkInAt! <= qr.expiresAt);
  assert.equal(qr.expiresAt.getTime() - qr.createdAt.getTime(), 60000);
  for (const photo of await client.workPhoto.findMany()) assert.equal(photo.sha256, createHash("sha256").update(photo.bytes).digest("hex"));
  for (const ack of await client.chatAcknowledgement.findMany({ include: { message: true } })) { assert.equal(ack.contentHash, messageFingerprint(ack.message)); assert.equal(ack.bodySnapshot, ack.message.body); assert(ack.acknowledgedAt >= (ack.message.editedAt || ack.message.createdAt)); }
  const tasks = await client.workTask.findMany({ include: { members: true } });
  for (const status of ["ASSIGNED", "SUBMITTED", "RETURNED", "VERIFIED", "CANCELLED"]) assert(tasks.some((t) => t.status === status), `Falta tarea ${status}`);
  for (const task of tasks.filter((t) => t.reviewedByUserId)) assert(!task.members.some((m) => m.userId === task.reviewedByUserId), "Verificacion propia de tarea");
  const requests = await client.personalEquipmentRequest.findMany({ include: { fulfilledIssue: { include: { equipment: true } } } });
  for (const status of ["PENDING", "APPROVED", "REJECTED", "FULFILLED", "CANCELLED"]) assert(requests.some((r) => r.status === status), `Falta solicitud ${status}`);
  for (const r of requests.filter((r) => r.status === "FULFILLED")) { assert.equal(r.userId, r.fulfilledIssue?.userId); assert.equal(r.category, r.fulfilledIssue?.equipment.category); assert(r.fulfilledAt! >= r.reviewedAt!); }
  const participations = await client.serviceParticipation.findMany({ include: { shift: { include: { assignments: true } }, incident: { include: { assignments: true } } } });
  assert(participations.some((p) => !p.verifiedAt && !p.cancelledAt)); assert(participations.some((p) => p.cancelledAt));
  for (const p of participations) {
    assert(p.startedAt < p.endedAt && p.endedAt <= new Date());
    assert(Boolean(p.shiftId) !== Boolean(p.incidentId));
    if (p.shift) { assert(p.shift.assignments.some((a) => a.userId === p.userId)); const bounds = shiftInterval(p.shift.date.toISOString().slice(0, 10), p.shift.startTime, p.shift.endTime); assert(p.startedAt.getTime() >= bounds.start && p.endedAt.getTime() <= bounds.end); }
    if (p.incident) { assert.equal(p.incident.status, "CLOSED"); assert(p.incident.assignments.some((a) => a.userId === p.userId)); assert(p.startedAt >= p.incident.occurredAt && p.endedAt <= p.incident.closedAt!); }
  }
  for (const trip of await client.waterTrip.findMany({ include: { crew: true } })) { assert(trip.returnedAt > trip.departedAt); assert(trip.crew.some((m) => m.userId === trip.leaderUserId)); if (trip.voidedAt) { assert.equal(trip.clientPaidAt, null); assert(trip.crew.every((m) => !m.paidAt)); } }
  for (const departure of await client.vehicleDeparture.findMany({ include: { crew: true } })) { assert.equal(departure.crew.filter((m) => m.isLeader).length, 1); assert(departure.returnedAt > departure.departedAt); }
  const issues = await client.personalEquipmentIssue.findMany({ where: { returnedAt: null } });
  assert.equal(new Set(issues.map((i) => i.equipmentId)).size, issues.length);
  for (const period of await client.emergencyAvailability.findMany()) { assert(!period.endsAt || period.endsAt > period.startsAt); assert(!period.cancelledAt || period.cancelledAt >= period.createdAt); }
  for (const document of await client.operationalDocument.findMany({ include: { shift: true, incident: true } })) {
    if (!document.publishedAt) continue;
    assert(document.publishedAt >= document.createdAt);
    if (document.shift) { const bounds = shiftInterval(document.shift.date.toISOString().slice(0, 10), document.shift.startTime, document.shift.endTime); assert(document.publishedAt.getTime() >= bounds.end); }
    if (document.incident?.closedAt) assert(document.publishedAt >= document.incident.closedAt);
  }
  const notices = await client.dispatchNotice.findMany({ include: { alert: true } });
  assert.equal(notices.length, 4);
  for (const notice of notices) {
    assert(!(notice.cancelledAt && notice.alertId));
    if (notice.alert) assert(notice.receivedAt <= notice.alert.createdAt);
    if (notice.cancelledAt) assert(notice.cancelledAt >= notice.receivedAt && notice.cancelReason);
  }
  const permits = await client.vehicleDriverAuthorization.findMany({ include: { license: true } });
  assert(permits.some(p => p.license?.revision === p.licenseRevision));
  assert(permits.some(p => p.license && p.license.revision !== p.licenseRevision));
  for (const permit of permits) {
    assert(permit.license && permit.userId === permit.license.userId);
    assert(permit.license.licenseClasses.includes(permit.requiredClass));
    assert(permit.validUntil <= permit.license.expiresOn!);
  }
  const claims = await client.expenseClaim.findMany({ include: { approvals: true, payments: true } });
  assert.equal(claims.length, 6);
  for (const claim of claims) {
    assert(claim.amountCents > 0);
    assert(claim.payments.filter(p => !p.reversedAt).reduce((sum, p) => sum + p.amountCents, 0) <= claim.amountCents);
    assert(claim.approvals.every(a => a.userId !== claim.userId));
    if (claim.officerExpense && claim.status === "APPROVED") assert(new Set(claim.approvals.filter(a => a.decision === "APPROVED" && a.rankSnapshot === "sub oficial").map(a => a.userId)).size >= 2);
  }
  const signed = await client.inspection.findUniqueOrThrow({ where: { id: "demo_v2_current_inspection_signed" }, include: { draft: true, responsibles: true } });
  assert(signed.draft?.closedAt && signed.confirmationsComplete);
  assert(signed.responsibles.every(r => r.confirmedAt && r.participatedAt && r.confirmedAt >= r.participatedAt));
  const proof = signed.draft.participants as Array<{ userId: string; attendanceId: string; joinedAt: string }>;
  for (const participant of proof) {
    const attendance = await client.attendance.findUniqueOrThrow({ where: { id: participant.attendanceId } });
    assert(attendance.userId === participant.userId && attendance.checkInQrId);
    assert(attendance.checkInAt! <= new Date(participant.joinedAt) && attendance.checkOutAt! >= new Date(participant.joinedAt));
  }
  const certifiedTask = await client.workTask.findUniqueOrThrow({ where: { id: "demo_v2_current_task_VERIFIED" }, include: { reviewedBy: { include: { profile: true } } } });
  assert(certifiedTask.officerApproved && certifiedTask.reviewedBy?.profile?.rank === "Oficial");
  const approvedTrip = await client.waterTrip.findUniqueOrThrow({ where: { id: "demo_v2_current_water_1" }, include: { crew: true } });
  assert(approvedTrip.earningsApprovedAt! >= approvedTrip.returnedAt);
  assert(approvedTrip.earningsApprovedById !== approvedTrip.createdByUserId && approvedTrip.crew.every(c => c.userId !== approvedTrip.earningsApprovedById));
  console.log("Escenarios verificados: cargos, QR, fotos, acuses, cronologia, avisos, licencias vinculadas, doble autorizacion, pagos, aval oficial y viajes revisados.");
}
