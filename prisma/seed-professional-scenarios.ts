import { createHash } from "node:crypto";
import sharp from "sharp";
import { Prisma } from "@prisma/client";
import { messageFingerprint } from "../src/utils/message-fingerprint";
import { stationDate } from "../src/utils/station-time";
import { defaults as rankingDefaults } from "../src/modules/ranking/ranking.rules";

const user = (key: string) => `demo_v2_${key}`;
const id = (key: string) => user(`professional_${key}`);
const operation = (n: number) => `00000000-0000-4000-a000-${String(n).padStart(12, "0")}`;

// Local synthetic evidence: no external URL, personal document or real payment.
async function receipt(index: number, amountCents: number) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="700" height="400"><rect width="700" height="400" fill="white"/><g fill="#111" font-family="sans-serif" font-size="26"><text x="35" y="60">SIMULACRO - SIN VALIDEZ FISCAL</text><text x="35" y="125">Comprobante sintetico DEMO-${index}</text><text x="35" y="185">Importe: ARS ${(amountCents / 100).toFixed(2)}</text><text x="35" y="245">No representa una compra ni un pago real.</text><text x="35" y="325">Prueba de acceso privado y autorizaciones.</text></g></svg>`;
  const bytes = await sharp(Buffer.from(svg)).jpeg({ quality: 80 }).toBuffer();
  return { receiptBytes: bytes, receiptSha256: createHash("sha256").update(bytes).digest("hex") };
}

export async function seedProfessionalScenarios(tx: Prisma.TransactionClient, reference: Date) {
  const marker = await tx.auditLog.findUnique({ where: { id: id("clock") } });
  const clock = marker?.createdAt ?? reference;
  const ago = (hours: number) => new Date(+clock - hours * 3600000);
  const day = (offset: number) => new Date(`${stationDate(new Date(+clock + offset * 86400000))}T00:00:00Z`);
  async function audit(key: string, actor: string, action: string, entityType: string, entityId: string, metadata: Prisma.InputJsonValue, createdAt: Date) {
    await tx.auditLog.upsert({ where: { id: id(`audit_${key}`) }, update: {}, create: { id: id(`audit_${key}`), actorUserId: user(actor), action, entityType, entityId, metadata, createdAt } });
  }

  await tx.rankingPolicy.upsert({ where: { id: "main" }, update: {}, create: { id: "main", config: rankingDefaults } });
  for (const [index, title] of ["Ordenar salon de capacitacion", "Actualizar inventario documental", "Revisar cartelera de seguridad", "Plantilla inactiva: no sortear"].entries()) {
    await tx.rankingTemplate.upsert({ where: { id: id(`ranking_template_${index}`) }, update: {}, create: {
      id: id(`ranking_template_${index}`), title: `[DEMO] ${title}`, description: "Actividad de practica. Debe asignarse sin sobrecargar al personal y requiere aval independiente para sumar puntos.", active: index < 3,
    } });
  }
  if (!marker) {
    const person = await tx.user.findUniqueOrThrow({ where: { id: user("mateo") }, include: { profile: true } });
    if (person.isActive && person.profile?.rank === "Bombero" && !person.guardEligible) {
      await tx.user.update({ where: { id: person.id }, data: { guardEligible: true } });
      await audit("guard_function", "admin", "GUARD_FUNCTION_GRANTED", "User", person.id,
        { synthetic: true, before: false, after: true, reason: "Bombero con funcion adicional de guardia para probar roles combinados" }, clock);
    }
  }

  // Upgrade evidence once, without altering approval, amount, owner or payment.
  for (const [index, key] of ["pending", "approved", "partial", "rejected", "officer_one", "officer_two"].entries()) {
    if (marker) continue;
    const claimId = user(`current_expense_${key}`), auditId = id(`audit_receipt_${key}`);
    if (await tx.auditLog.findUnique({ where: { id: auditId } })) continue;
    const claim = await tx.expenseClaim.findUniqueOrThrow({ where: { id: claimId } });
    if (claim.receiptBytes || claim.receiptSha256 || claim.receiptUrl) continue;
    await tx.expenseClaim.update({ where: { id: claimId }, data: await receipt(index, claim.amountCents) });
    await audit(`receipt_${key}`, "admin", "SYSTEM_DEMO_RECEIPT_ATTACHED", "ExpenseClaim", claimId,
      { synthetic: true, reason: "Comprobante ficticio del escenario, sin modificar su decision financiera" }, clock);
  }

  for (const [index, state] of ["paid", "reversed"].entries()) {
    const claimId = id(`expense_${state}`), amountCents = 245000 + index * 50000;
    await tx.expenseClaim.upsert({ where: { id: claimId }, update: {}, create: {
      id: claimId, operationKey: operation(10 + index), userId: user("camila"), amountCents,
      title: `[DEMO] Reintegro ${index ? "con pago revertido: deuda reabierta" : "pagado por completo: saldo cero"}`,
      notes: "Compra sintetica de insumos. No realizar transferencias reales.", ...await receipt(20 + index, amountCents),
      occurredOn: day(-5), createdAt: ago(100), status: "APPROVED", revision: 3,
      reviewNote: "Comprobante sintetico revisado por jefatura independiente",
    } });
    await tx.expenseApproval.upsert({ where: { claimId_userId: { claimId, userId: user("oficial") } }, update: {}, create: {
      id: id(`approval_${state}`), claimId, userId: user("oficial"), rankSnapshot: "oficial", decision: "APPROVED",
      note: "Aval sintetico independiente del titular del gasto", createdAt: ago(80),
    } });
    await audit(`approved_${state}`, "oficial", "EXPENSE_APPROVED", "ExpenseClaim", claimId, { synthetic: true, amountCents }, ago(80));
    await tx.expensePayment.upsert({ where: { id: id(`payment_${state}`) }, update: {}, create: {
      id: id(`payment_${state}`), claimId, operationKey: operation(20 + index), amountCents,
      reference: `DEMO-NO-BANCARIO-${state.toUpperCase()}`, createdAt: ago(60), reversedAt: index ? ago(50) : null,
    } });
    await audit(`paid_${state}`, "admin", "EXPENSE_PAYMENT_RECORDED", "ExpenseClaim", claimId,
      { synthetic: true, paymentId: id(`payment_${state}`), amountCents, reference: "NO ES UN PAGO REAL" }, ago(60));
    if (index) await audit(`reversed_${state}`, "admin", "EXPENSE_PAYMENT_REVERSED", "ExpenseClaim", claimId,
      { synthetic: true, paymentId: id(`payment_${state}`), reason: "Referencia de pago de prueba equivocada; deuda nuevamente pendiente" }, ago(50));
  }

  for (const [index, status] of ["ACCEPTED", "REJECTED", "CANCELLED"].entries()) {
    const taskId = id(`task_transfer_${status}`), fromUserId = user("bombero"), toUserId = user("camila");
    await tx.workTask.upsert({ where: { id: taskId }, update: {}, create: {
      id: taskId, title: `[DEMO] Transferencia ${status === "ACCEPTED" ? "aceptada por Camila" : status === "REJECTED" ? "rechazada: sigue Bombero" : "cancelada: sigue Bombero"}`,
      description: "Actualizar una ficha documental. Escenario remoto: la aceptacion no exige presencia QR.", requiresPresence: false,
      createdByUserId: user("oficial"), dueOn: day(5 + index), createdAt: ago(48), revision: 3,
      members: { create: { userId: status === "ACCEPTED" ? toUserId : fromUserId } },
    } });
    await tx.workTaskTransfer.upsert({ where: { id: id(`transfer_${status}`) }, update: {}, create: {
      id: id(`transfer_${status}`), taskId, fromUserId, toUserId, status, notes: "[DEMO] Solicitud documental de reemplazo", createdAt: ago(24), resolvedAt: ago(20),
    } });
    for (const [n, action] of ["CREATED", "TRANSFER_REQUESTED", status === "ACCEPTED" ? "TRANSFER" : status === "REJECTED" ? "TRANSFER_REJECTED" : "TRANSFER_CANCELLED"].entries()) {
      const actor = n === 0 ? "oficial" : n === 1 || status === "CANCELLED" ? "bombero" : "camila";
      await tx.workTaskEvent.upsert({ where: { id: id(`transfer_event_${status}_${n}`) }, update: {}, create: {
        id: id(`transfer_event_${status}_${n}`), taskId, actorUserId: user(actor), action, notes: "[DEMO] Se conserva la responsabilidad hasta aceptar el cambio", createdAt: ago([48, 24, 20][n]!),
      } });
    }
    await audit(`transfer_${status}`, status === "CANCELLED" ? "bombero" : "camila", status === "ACCEPTED" ? "WORK_TEAM_CHANGED" : `WORK_TRANSFER_${status}`, "WorkTask", taskId,
      { synthetic: true, fromUserId, toUserId, status }, ago(20));
  }

  const declinedId = id("task_declined_reclaimed");
  await tx.workTask.upsert({ where: { id: declinedId }, update: {}, create: {
    id: declinedId, title: "[DEMO] Tarea retomada: conserva penalizacion anterior", description: "Mateo indico No puedo y luego volvio a tomarla. El historial de rechazo no debe desaparecer del ranking.",
    requiresPresence: false, createdByUserId: user("oficial"), dueOn: day(6), createdAt: ago(48), revision: 3, members: { create: { userId: user("mateo") } },
  } });
  for (const [index, action] of ["CREATED", "DECLINE", "CLAIMED"].entries()) await tx.workTaskEvent.upsert({ where: { id: id(`declined_event_${index}`) }, update: {}, create: {
    id: id(`declined_event_${index}`), taskId: declinedId, actorUserId: user(index ? "mateo" : "oficial"), action,
    notes: "[DEMO] Penalizacion historica independiente de la asignacion actual", createdAt: ago([48, 24, 12][index]!),
  } });

  const verifiedId = id("task_subofficer_verified");
  await tx.workTask.upsert({ where: { id: verifiedId }, update: {}, create: {
    id: verifiedId, title: "[DEMO] Trabajo remoto avalado por suboficial", description: "Revisar contactos operativos desde casa, sin QR. El aval de suboficial tambien valida la realizacion.",
    requiresPresence: false, status: "VERIFIED", officerApproved: true, createdByUserId: user("oficial"), dueOn: day(-1),
    createdAt: ago(100), completedAt: ago(75), completionNotes: "Directorio revisado con evidencia documental sintetica",
    reviewedByUserId: user("operador"), reviewedAt: ago(70), reviewNotes: "Validacion independiente de suboficial", revision: 3,
    members: { create: { userId: user("aspirante") } },
  } });
  for (const [index, action] of ["CREATED", "SUBMITTED", "VERIFIED"].entries()) await tx.workTaskEvent.upsert({ where: { id: id(`remote_event_${index}`) }, update: {}, create: {
    id: id(`remote_event_${index}`), taskId: verifiedId, actorUserId: user(["oficial", "aspirante", "operador"][index]!), action,
    notes: "[DEMO] Trabajo remoto con aval independiente", createdAt: ago([100, 75, 70][index]!),
  } });
  await audit("remote_verified", "operador", "WORK_VERIFIED", "WorkTask", verifiedId, { synthetic: true, requiresPresence: false, officerApproved: true }, ago(70));

  // A prior acknowledgement is evidence of the old version, not of the edit.
  const messageId = id("message_edited"), original = "[DEMO] Practica el viernes a las 18:00.", body = "[DEMO] Cambio de horario: practica el viernes a las 19:00. Confirmen nuevamente la lectura.";
  await tx.chatMessage.upsert({ where: { id: messageId }, update: {}, create: {
    id: messageId, authorUserId: user("oficial"), body, isPinned: true, createdAt: ago(48), editedAt: ago(12),
  } });
  for (const [key, current] of [["bombero", false], ["sofia", true]] as const) await tx.chatAcknowledgement.upsert({ where: { id: id(`ack_${key}`) }, update: {}, create: {
    id: id(`ack_${key}`), messageId, userId: user(key), bodySnapshot: current ? body : original,
    contentHash: messageFingerprint({ id: messageId, body: current ? body : original, createdAt: ago(48), editedAt: current ? ago(12) : null }), acknowledgedAt: ago(current ? 10 : 30),
  } });
  await audit("message_edited", "oficial", "CHAT_MESSAGE_UPDATED", "ChatMessage", messageId,
    { synthetic: true, before: original, after: body, reason: "Cambio de horario: los acuses anteriores no confirman esta version" }, ago(12));

  const incident = await tx.incident.findFirst({ where: { status: "CLOSED", voidedAt: null }, orderBy: { closedAt: "desc" } });
  if (incident?.closedAt) for (const [index, category] of ["NOVELTY", "THIRD_PARTY", "CORRECTION", "DAMAGE"].entries()) {
    await tx.incidentNotebookEntry.upsert({ where: { id: id(`annex_${category}`) }, update: {}, create: {
      id: id(`annex_${category}`), incidentId: incident.id, category, authorUserId: user("oficial"),
      title: `[DEMO] Anexo posterior: ${["novedad", "terceros", "rectificacion documental", "rotura"][index]}`,
      body: "Informacion sintetica agregada despues del cierre. No modifica ni reabre la planilla original.",
      occurredAt: new Date(+incident.closedAt + (index + 1) * 60000), createdAt: new Date(+incident.closedAt + (index + 1) * 60000),
    } });
  }

  await tx.auditLog.upsert({ where: { id: id("clock") }, update: {}, create: {
    id: id("clock"), action: "SYSTEM_DEMO_PROFESSIONAL_SEEDED", entityType: "System", entityId: "demo-v5", createdAt: clock,
    metadata: { synthetic: true, version: 5, reason: "Escenarios reproducibles sin sobrescribir las decisiones tomadas al probar" },
  } });
}
