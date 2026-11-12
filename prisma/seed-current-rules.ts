import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { stationDate } from "../src/utils/station-time";

const member = (key: string) => `demo_v2_${key}`;
const id = (key: string) => member(`current_${key}`);
const operation = (n: number) => `00000000-0000-4000-9000-${String(n).padStart(12, "0")}`;
const hash = (text: string) => createHash("sha256").update(text).digest("hex");

// Create-only scenarios: reruns must not undo decisions made while testing.
export async function seedCurrentRules(tx: Prisma.TransactionClient, passwordHash: string, reference: Date) {
  const anchor = new Date(stationDate(reference) + "T00:00:00Z");
  const day = (offset: number) => new Date(+anchor + offset * 86400000);
  const at = (offset: number, hour: number, minute = 0) => new Date(`${day(offset).toISOString().slice(0, 10)}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00-03:00`);
  async function audit(key: string, actor: string, action: string, entityType: string, entityId: string, metadata: Prisma.InputJsonValue, createdAt: Date) {
    await tx.auditLog.upsert({ where: { id: id(`audit_${key}`) }, update: {}, create: {
      id: id(`audit_${key}`), actorUserId: member(actor), action, entityType, entityId, metadata, createdAt,
    } });
  }
  await tx.user.upsert({ where: { id: member("suboficial") }, update: {}, create: {
    id: member("suboficial"), username: "demo.suboficial", passwordHash, role: "OPERATOR",
    email: "suboficial@bomberos.demo.invalid", profile: { create: {
      fullName: "[DEMO] Segunda suboficial - autorizacion independiente", rank: "Sub oficial", dni: "DEMO-SUB-2", badge: "DEMO-SUB-2",
      phone: "0000000000", bloodType: "A+", joinDate: day(-900), birthDate: day(-35 * 365),
    } },
  } });
  for (const [index, key] of ["oficial", "subjefe", "operador"].entries()) {
    for (const [part, title] of ["Casco", "Chaqueton", "Pantalon", "Botas", "Guantes", "Capucha"].entries()) {
      await tx.personalDeclaration.upsert({ where: { id: id(`clothing_${key}_${part}`) }, update: {}, create: {
        id: id(`clothing_${key}_${part}`), userId: member(key), category: "CLOTHING", title: `[DEMO] ${title} personal`,
        details: "Declaracion sintetica individual, distinta de la custodia institucional", clothingBrand: "Marca ficticia", clothingModel: `DEMO-${part + 1}`,
        clothingSize: part === 3 ? String(40 + index) : "L", clothingCondition: "OK", clothingNovelties: "Sin novedades declaradas; sin certificacion real",
      } });
    }
    await tx.personalDeclaration.upsert({ where: { id: id(`license_${key}`) }, update: {}, create: {
      id: id(`license_${key}`), userId: member(key), category: "DRIVER_LICENSE", title: "[DEMO] Licencia declarada de jefatura",
      details: "Declaracion personal ficticia; no habilita automaticamente a conducir un movil", licenseNumber: `DEMO-JEF-${index}`, issuer: "Emisor ficticio",
      licenseClasses: ["B.1", "C.1"], issuedOn: day(-600), expiresOn: day(280),
    } });
  }

  // Explicit one-time demo delegation. Subsequent runs preserve administrative changes.
  if (!await tx.auditLog.findUnique({ where: { id: id("audit_finance_delegate") } })) {
    const official = await tx.user.findUniqueOrThrow({ where: { id: member("oficial") }, include: { profile: true } });
    if (official.profile?.rank === "Oficial" && !official.deletedAt && official.isActive) {
      await tx.user.update({ where: { id: official.id }, data: { financeChief: true } });
      await audit("finance_delegate", "admin", "FINANCE_CHIEF_CHANGED", "User", official.id,
        { synthetic: true, before: official.financeChief, after: true, reason: "Jefatura financiera de demostracion para revisar gastos y viajes" }, at(-1, 8));
    }
  }

  const noticeCases = ["pending", "corrected", "cancelled", "activated"] as const;
  for (const [index, state] of noticeCases.entries()) {
    const alertId = state === "activated" ? member("extended_alert_6") : null;
    await tx.dispatchNotice.upsert({ where: { id: id(`notice_${state}`) }, update: {}, create: {
      id: id(`notice_${state}`), operatorId: member("guardia"), source: `[DEMO] Central - aviso ${state}`, phone: "0000000000",
      location: state === "activated" ? "Ubicacion ficticia 7" : `[DEMO] Direccion de practica ${index + 1}`,
      type: state === "activated" ? "ACCIDENT" : "OTHER", priority: state === "activated" ? "MEDIUM" : "LOW",
      notes: "SIMULACRO. Practicar registro, correccion, anulacion y convocatoria; no despachar recursos reales.",
      referral: "Guardia de demostracion", receivedAt: state === "activated" ? at(-6, 9, 55) : at(-1, 9, index * 5), alertId,
      revision: state === "pending" ? 1 : 2, cancelledAt: state === "cancelled" ? at(-1, 10) : null,
      cancelReason: state === "cancelled" ? "Aviso duplicado confirmado con central; registro conservado" : null,
    } });
    await audit(`notice_${state}`, "guardia", state === "corrected" ? "NOTICE_CORRECTED" : state === "cancelled" ? "NOTICE_CANCELLED" : state === "activated" ? "NOTICE_ACTIVATED" : "NOTICE_RECEIVED",
      "DispatchNotice", id(`notice_${state}`), { synthetic: true, reason: "Escenario sintetico de ciclo del aviso", revision: state === "pending" ? 1 : 2 }, at(-1, 10));
  }

  for (const [index, key] of ["bombero", "sofia", "camila"].entries()) {
    const licenseId = id(`license_${key}`), stale = index === 1, expired = index === 2;
    await tx.personalDeclaration.upsert({ where: { id: licenseId }, update: {}, create: {
      id: licenseId, userId: member(key), category: "DRIVER_LICENSE", title: `[DEMO] Licencia ${stale ? "modificada: revalidar" : expired ? "vencida" : "revisada por jefatura"}`,
      details: "Documento sintetico sin validez legal. Habilitacion por movil independiente de la declaracion.",
      licenseNumber: `DEMO-ACTUAL-${index}`, issuer: "Emisor ficticio", licenseClasses: ["B.1", "C.1"],
      issuedOn: day(-400), expiresOn: day(expired ? -1 : 300), revision: stale ? 2 : 1,
    } });
    await tx.vehicleDriverAuthorization.upsert({ where: { assetId_userId: { assetId: member(`asset_${index}`), userId: member(key) } }, update: {}, create: {
      assetId: member(`asset_${index}`), userId: member(key), licenseId, licenseRevision: 1,
      requiredClass: "C.1", validUntil: day(expired ? -1 : 180), grantedByUserId: member("oficial"),
      reason: "DEMO: revision documental sintetica; el cambio o vencimiento bloquea nuevos despachos",
    } });
    await audit(`permit_${key}`, "oficial", "DRIVER_AUTHORIZATION_SAVED", "Asset", member(`asset_${index}`),
      { synthetic: true, userId: member(key), licenseId, licenseRevision: 1, requiredClass: "C.1", nextRevision: 1 }, at(-4, 10));
  }

  for (const [index, state] of ["pending", "approved", "partial", "rejected", "officer_one", "officer_two"].entries()) {
    const officerExpense = index >= 4, approved = ["approved", "partial", "officer_two"].includes(state);
    const claimId = id(`expense_${state}`), amountCents = 120000 + index * 10000;
    await tx.expenseClaim.upsert({ where: { id: claimId }, update: {}, create: {
      id: claimId, operationKey: operation(100 + index), userId: member(officerExpense ? "oficial" : "bombero"), officerExpense,
      title: `[DEMO] ${["Compra pendiente de revision", "Insumos aprobados sin pagar", "Reintegro parcialmente pagado", "Comprobante rechazado", "Gasto de oficial: falta segundo aval", "Gasto de oficial: dos avales"][index]}`,
      notes: "Gasto exclusivamente sintetico, sin comprobante fiscal real ni transferencia bancaria.", occurredOn: day(-6), amountCents,
      status: approved ? "APPROVED" : state === "rejected" ? "REJECTED" : "PENDING", revision: state === "officer_two" ? 3 : state === "pending" ? 1 : 2,
      reviewNote: approved ? "Revision independiente de demostracion" : state === "rejected" ? "Comprobante sintetico insuficiente" : null, createdAt: at(-6, 12),
    } });
    const reviewers = officerExpense ? state === "officer_two" ? ["operador", "suboficial"] : ["operador"] : approved || state === "rejected" ? ["admin"] : [];
    for (const [n, reviewer] of reviewers.entries()) {
      const approvalId = id(`approval_${state}_${n}`);
      await tx.expenseApproval.upsert({ where: { id: approvalId }, update: {}, create: {
        id: approvalId, claimId, userId: member(reviewer), rankSnapshot: officerExpense ? "sub oficial" : "administrador",
        decision: state === "rejected" ? "REJECTED" : "APPROVED", note: "Revision sintetica independiente del autor del gasto", createdAt: at(-5 + n, 10),
      } });
      await audit(`expense_${state}_${n}`, reviewer, officerExpense ? "OFFICER_EXPENSE_AUTHORIZED" : state === "rejected" ? "EXPENSE_REJECTED" : "EXPENSE_APPROVED",
        "ExpenseClaim", claimId, { synthetic: true, approvalId, amountCents, authorizations: n + 1 }, at(-5 + n, 10));
    }
    if (state === "partial") {
      const paymentId = id("expense_partial_payment");
      await tx.expensePayment.upsert({ where: { id: paymentId }, update: {}, create: {
        id: paymentId, claimId, operationKey: operation(200), amountCents: 50000, reference: "DEMO-REINTEGRO-PARCIAL-NO-REAL", createdAt: at(-3, 11),
      } });
      await audit("expense_payment", "admin", "EXPENSE_PAYMENT_RECORDED", "ExpenseClaim", claimId, { synthetic: true, paymentId, amountCents: 50000, reference: "DEMO-REINTEGRO-PARCIAL-NO-REAL" }, at(-3, 11));
    }
  }

  for (const [index, status] of (["PENDING", "APPROVED", "REJECTED"] as const).entries()) {
    await tx.courseAttendance.upsert({ where: { id: id(`course_${index}`) }, update: {}, create: {
      id: id(`course_${index}`), userId: member("bombero"), title: `[DEMO] Practica documental ${index + 1}`, provider: "Escuela ficticia", completedOn: day(-8 - index),
      status, reviewerId: status === "PENDING" ? null : member("oficial"), reviewedAt: status === "PENDING" ? null : at(-6, 10),
      reviewNote: status === "REJECTED" ? "Certificado de demostracion incompleto" : status === "APPROVED" ? "Asistencia ficticia verificada de forma independiente" : null, createdAt: at(-7, 12),
    } });
  }

  // Closed historical QR proof: no active QR token or authenticated session is seeded.
  const start = at(-1, 1), end = at(-1, 3);
  await tx.qrChallenge.upsert({ where: { id: id("control_qr") }, update: {}, create: {
    id: id("control_qr"), stationId: member("central"), createdByUserId: member("guardia"), tokenHash: hash("DEMO-CURRENT-EXPIRED-NOT-A-TOKEN"),
    createdAt: new Date(+start - 15000), expiresAt: new Date(+start + 45000), revokedAt: end, consumedCount: 2,
  } });
  for (const key of ["bombero", "sofia"]) await tx.attendance.upsert({ where: { id: id(`qr_${key}`) }, update: {}, create: {
    id: id(`qr_${key}`), userId: member(key), stationId: member("central"), checkInQrId: id("control_qr"),
    checkInAt: start, checkOutAt: end, status: "CLOSED", workedMinutes: 120, checkInTrust: "HIGH", checkOutTrust: "HIGH", checkInDevice: "DEMO-HISTORICO", createdAt: start,
  } });
  const participants = ["bombero", "sofia"].map(key => ({ userId: member(key), attendanceId: id(`qr_${key}`), joinedAt: at(-1, 1, 5).toISOString() }));
  await tx.controlDraft.upsert({ where: { id: id("draft_closed") }, update: {}, create: {
    id: id("draft_closed"), ownerId: member("bombero"), vehicleId: member("vehicle_0"), startedAt: at(-1, 1, 5), closedAt: at(-1, 2), participants, revision: 2,
  } });
  const items = await tx.vehicleInventoryItem.findMany({ where: { compartment: { vehicleId: member("vehicle_0") } } });
  await tx.inspection.upsert({ where: { id: id("inspection_signed") }, update: {}, create: {
    id: id("inspection_signed"), draftId: id("draft_closed"), vehicleId: member("vehicle_0"), inspectionDate: day(-1), inspectionTime: "02:00",
    leaderUserId: member("bombero"), createdByUserId: member("bombero"), resultingAssetStatus: "OPERATIONAL", summaryOk: items.length,
    observations: "DEMO: planilla completa con asistencia QR previa y conformidad independiente de todo el equipo; no certifica un movil real", createdAt: at(-1, 2),
  } });
  for (const item of items) await tx.inspectionItem.upsert({ where: { id: id(`checked_${item.id.replace("demo_v2_", "")}`) }, update: {}, create: {
    id: id(`checked_${item.id.replace("demo_v2_", "")}`), inspectionId: id("inspection_signed"), inventoryItemId: item.id, expectedQuantity: item.expectedQuantity, observedQuantity: item.expectedQuantity, result: "OK",
  } });
  for (const [index, key] of ["bombero", "sofia"].entries()) await tx.inspectionResponsible.upsert({ where: { inspectionId_userId: { inspectionId: id("inspection_signed"), userId: member(key) } }, update: {}, create: {
    id: id(`signer_${key}`), inspectionId: id("inspection_signed"), userId: member(key), participatedAt: at(-1, 1, 5), assignedAt: at(-1, 1, 5), confirmedAt: at(-1, 2, index),
  } });
  for (const [index, status] of (["VERIFIED", "SUBMITTED"] as const).entries()) {
    const taskId = id(`task_${status}`);
    await tx.workTask.upsert({ where: { id: taskId }, update: {}, create: {
      id: taskId, title: `[DEMO] Trabajo ${status === "VERIFIED" ? "avalado por oficial" : "esperando aval"}`, description: "Tarea de orden con permanencia QR acreditada; solo el aval independiente del oficial habilita puntos.",
      status, officerApproved: status === "VERIFIED", createdByUserId: member("guardia"), dueOn: day(2), completedAt: at(-1, 2, 30), completionNotes: "Ejecucion sintetica para probar el circuito de aval",
      reviewedByUserId: status === "VERIFIED" ? member("oficial") : null, reviewedAt: status === "VERIFIED" ? at(-1, 4) : null,
      reviewNotes: status === "VERIFIED" ? "Verificacion independiente ficticia por oficial" : null, createdAt: at(-2, 10), revision: status === "VERIFIED" ? 3 : 2,
    } });
    await tx.workTaskMember.upsert({ where: { taskId_userId: { taskId, userId: member(index ? "sofia" : "bombero") } }, update: {}, create: { taskId, userId: member(index ? "sofia" : "bombero") } });
    for (const action of ["CREATED", "SUBMITTED", ...(status === "VERIFIED" ? ["VERIFIED"] : [])]) await tx.workTaskEvent.upsert({ where: { id: id(`task_${index}_${action}`) }, update: {}, create: {
      id: id(`task_${index}_${action}`), taskId, actorUserId: member(action === "CREATED" ? "guardia" : action === "VERIFIED" ? "oficial" : index ? "sofia" : "bombero"), action,
      notes: "Evento sintetico del ciclo de tarea", createdAt: action === "CREATED" ? at(-2, 10) : action === "VERIFIED" ? at(-1, 4) : at(-1, 2, 30),
    } });
  }
  for (const [index, approved] of [false, true].entries()) {
    const tripId = id(`water_${index}`), departedAt = at(-5 - index, 4), returnedAt = at(-5 - index, 6);
    await tx.waterTrip.upsert({ where: { id: tripId }, update: {}, create: {
      id: tripId, operationKey: operation(300 + index), requestHash: hash(`demo-current-water-${index}`), assetId: member("asset_2"),
      customer: "[DEMO] Cliente ficticio", destination: `[DEMO] Viaje ${approved ? "con deuda aprobada" : "por verificar"}`, departedAt, returnedAt,
      startOdometer: 65000 + index * 30, endOdometer: 65020 + index * 30, tripCount: 1, chargeCents: 500000,
      leaderUserId: member("nicolas"), createdByUserId: member("guardia"), notes: "Viaje sintetico; remuneracion propuesta no equivale a deuda sin revision financiera",
      earningsApprovedAt: approved ? at(-4, 10) : null, earningsApprovedById: approved ? member("oficial") : null,
      earningsApprovalNote: approved ? "Revision financiera sintetica independiente de creador y dotacion" : null, createdAt: returnedAt, revision: approved ? 2 : 1,
    } });
    await tx.waterTripMember.upsert({ where: { tripId_userId: { tripId, userId: member("nicolas") } }, update: {}, create: { tripId, userId: member("nicolas"), compensationCents: 80000 } });
    if (approved) await audit("water_approved", "oficial", "WATER_EARNINGS_APPROVED", "WaterTrip", tripId,
      { synthetic: true, note: "Remuneracion verificada sin transferencia real", revision: 1, crew: [{ userId: member("nicolas"), compensationCents: 80000 }], chargeCents: 500000 }, at(-4, 10));
  }
}
