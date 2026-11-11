import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";

// Escenarios de las reglas del cuestionario del 10/11/2026 y de las decisiones posteriores.
// Igual que el resto del seed: identificadores estables y solo creacion; repetirlo no deshace
// lo que se modifico al probar. Los pocos ajustes sobre datos existentes se aplican una sola vez,
// controlados por una marca de auditoria.
const member = (key: string) => `demo_v2_${key}`;
const id = (key: string) => member(`q_${key}`);
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const HOUR = 3600000;

export async function seedQuestionnaireScenarios(tx: Prisma.TransactionClient) {
  const marker = await tx.auditLog.findUnique({ where: { id: id("marker") } });
  const firstRun = !marker;
  // Reloj propio: los escenarios se anclan al momento en que se sembraron por primera vez.
  const clock = marker?.createdAt ?? new Date();
  const ago = (hours: number) => new Date(clock.getTime() - hours * HOUR);
  const summary: Record<string, number | string> = {};
  const audit = async (key: string, actor: string | null, action: string, entityType: string, entityId: string, metadata: Prisma.InputJsonValue, createdAt: Date) =>
    tx.auditLog.upsert({ where: { id: id(`audit_${key}`) }, update: {}, create: { id: id(`audit_${key}`), actorUserId: actor ? member(actor) : null, action, entityType, entityId, metadata, createdAt } });

  // ---------------------------------------------------------------------------
  // 1. Coherencia (B01): el administrador tecnico no integra guardias ni grupos.
  // ---------------------------------------------------------------------------
  if (firstRun) {
    const removedShifts = await tx.shiftAssignment.deleteMany({ where: { userId: member("admin"), shift: { date: { gte: new Date(clock.toISOString().slice(0, 10)) } } } });
    const removedGroup = await tx.controlGroupMember.deleteMany({ where: { userId: member("admin") } });
    summary.coherencia = `admin fuera de ${removedShifts.count} guardias futuras y ${removedGroup.count} grupo`;
  }

  // ---------------------------------------------------------------------------
  // 2. Disponibilidad (D01-D04): confirmados, sin confirmar y ausentes.
  //    Sin confirmar quedan: suboficial, directiva, menor y clave_inicial.
  //    camila tiene un periodo de ausencia vigente (seed extendido).
  // ---------------------------------------------------------------------------
  const confirmed = ["bombero", "sofia", "nicolas", "lucia", "mateo", "aspirante", "oficial", "subjefe", "operador", "camila", "guardia"];
  if (firstRun) await tx.user.updateMany({ where: { id: { in: confirmed.map(member) }, emergencyStatusConfirmedAt: null }, data: { emergencyStatusConfirmedAt: ago(72) } });
  const absent = await tx.emergencyAvailability.findMany({ where: { cancelledAt: null, startsAt: { lte: clock }, OR: [{ endsAt: null }, { endsAt: { gt: clock } }] }, select: { userId: true } });
  const absentIds = new Set(absent.map(row => row.userId));
  const available = confirmed.map(member).filter(userId => !absentIds.has(userId));

  // ---------------------------------------------------------------------------
  // 3. Permisos especiales (B10/B11), una sola vez y solo si no tienen otros.
  // ---------------------------------------------------------------------------
  const grants: Array<[string, string]> = [["sofia", "FLEET"], ["lucia", "PPE"], ["nicolas", "TECHNICAL"], ["directiva", "FINANCE"]];
  if (firstRun) for (const [key, permission] of grants) {
    const changed = await tx.user.updateMany({ where: { id: member(key), specialPermissions: { isEmpty: true } }, data: { specialPermissions: [permission] } });
    if (changed.count) await audit(`grant_${key}`, "admin", "SPECIAL_PERMISSION_GRANTED", "User", member(key), { permission, before: [], after: [permission], reason: "[DEMO] Designacion de responsable para pruebas" }, ago(240));
  }

  // ---------------------------------------------------------------------------
  // 4. Presencia QR (E): presentes, descartada por vencimiento, GPS sospechoso.
  // ---------------------------------------------------------------------------
  const station = await tx.station.findUniqueOrThrow({ where: { id: member("central") } });
  const entryQr = (key: string, checkInAt: Date) => tx.qrChallenge.upsert({ where: { id: id(`entry_qr_${key}`) }, update: {}, create: {
    id: id(`entry_qr_${key}`), stationId: station.id, tokenHash: hash(id(`entry_qr_${key}`)),
    createdAt: new Date(+checkInAt - 15000), expiresAt: new Date(+checkInAt + 45000), revokedAt: new Date(+checkInAt + 60000),
    createdByUserId: member("guardia"), consumedCount: 1,
  } });
  const present: Array<[string, number]> = [["lucia", 2], ["nicolas", 5]];
  for (const [key, hours] of present) {
    if (await tx.attendance.findFirst({ where: { userId: member(key), status: "OPEN" }, select: { id: true } })) continue;
    const qr = await entryQr(key, ago(hours));
    await tx.attendance.upsert({ where: { id: id(`present_${key}`) }, update: {}, create: { id: id(`present_${key}`), userId: member(key), stationId: station.id, status: "OPEN", checkInAt: ago(hours), lastPresenceConfirmedAt: clock, checkInTrust: "HIGH", checkInLatitude: station.latitude, checkInLongitude: station.longitude, checkInAccuracy: 12, checkInDevice: "[DEMO] celular", checkInQrId: qr.id } });
  }
  // E08/L05: cerrada por no revalidar; no suma horas ni puntos.
  const timedOutStart = ago(76), timedOutEnd = ago(75);
  const qr = await entryQr("timed_out_sofia", ago(77));
  await tx.attendance.upsert({ where: { id: id("timed_out_sofia") }, update: {}, create: { id: id("timed_out_sofia"), userId: member("sofia"), stationId: member("central"), status: "CLOSED", checkInAt: ago(77), checkOutAt: timedOutEnd, workedMinutes: 0, checkInTrust: "HIGH", checkInQrId: qr.id, promptShownAt: timedOutStart, promptDueAt: timedOutStart, discardedAt: timedOutEnd, discardReason: "Cierre automatico sin revalidacion" } });
  await audit("timed_out_sofia", null, "SYSTEM_PRESENCE_TIMED_OUT", "Attendance", id("timed_out_sofia"), { userId: member("sofia"), reason: "Sin confirmación válida en el plazo", discarded: true }, timedOutEnd);
  // T09: ubicacion con senales de falsificacion (marcada, no bloqueada).
  await audit("gps_nicolas", "nicolas", "PRESENCE_GPS_SUSPICIOUS", "Attendance", id("present_nicolas"), { context: "Ingreso por QR", reasons: ["Precisión informada inferior a 1 metro", "Coordenadas redondeadas"] }, ago(5));

  // ---------------------------------------------------------------------------
  // 5. Correcciones de fichaje con doble autorizacion (E09/E10).
  // ---------------------------------------------------------------------------
  const nicolasOpen = await tx.attendance.findFirst({ where: { userId: member("nicolas"), status: "OPEN" }, select: { id: true } });
  if (nicolasOpen) await tx.attendanceCorrection.upsert({ where: { id: id("correction_pending") }, update: {}, create: { id: id("correction_pending"), attendanceId: nicolasOpen.id, action: "CLOSE", effectiveAt: ago(1), reason: "[DEMO] Se retiró del cuartel sin registrar la salida; lo confirmó por teléfono", requestedByUserId: member("guardia"), createdAt: ago(1) } });
  const manual = await tx.attendance.upsert({ where: { id: id("manual_open_camila") }, update: {}, create: { id: id("manual_open_camila"), userId: member("camila"), stationId: member("central"), status: "CLOSED", checkInAt: ago(30), checkOutAt: ago(27), workedMinutes: 180, checkInTrust: "MEDIUM", checkInQrId: `manual:${id("correction_approved")}`, checkInDevice: "APERTURA_MANUAL_DOBLE_AUTORIZACION", checkOutTrust: "MEDIUM" } });
  await tx.attendanceCorrection.upsert({ where: { id: id("correction_approved") }, update: {}, create: { id: id("correction_approved"), attendanceId: manual.id, action: "OPEN", effectiveAt: ago(30), reason: "[DEMO] GPS impreciso dentro del cuartel; presencia verificada por la guardia", status: "APPROVED", requestedByUserId: member("guardia"), decidedByUserId: member("subjefe"), decisionNote: "Constatada en persona durante la guardia", decidedAt: ago(29), createdAt: ago(30) } });
  const rejected = await tx.attendance.upsert({ where: { id: id("manual_rejected_mateo") }, update: {}, create: { id: id("manual_rejected_mateo"), userId: member("mateo"), stationId: member("central"), status: "CLOSED", checkInAt: ago(50), checkOutAt: ago(50), workedMinutes: 0, checkInTrust: "REJECTED", checkInDevice: "APERTURA_MANUAL_PENDIENTE" } });
  await tx.attendanceCorrection.upsert({ where: { id: id("correction_rejected") }, update: {}, create: { id: id("correction_rejected"), attendanceId: rejected.id, action: "OPEN", effectiveAt: ago(50), reason: "[DEMO] Pide abrir ingreso por falla del celular", status: "REJECTED", requestedByUserId: member("guardia"), decidedByUserId: member("operador"), decisionNote: "No consta su presencia en el cuartel a esa hora", decidedAt: ago(49), createdAt: ago(50) } });

  // ---------------------------------------------------------------------------
  // 6. Flujo completo de emergencia: aviso -> alerta -> convocatoria -> salidas.
  // ---------------------------------------------------------------------------
  const alert = await tx.alert.upsert({ where: { id: id("alert_house_fire") }, update: {}, create: { id: id("alert_house_fire"), type: "FIRE", priority: "HIGH", location: "[DEMO] Belgrano 1250, Sampacho", description: "[DEMO] Incendio en vivienda familiar; humo visible desde la calle. Vecinos evacuados.", contactPhone: "0000000001", createdByUserId: member("guardia"), createdAt: ago(1.5) } });
  await tx.dispatchNotice.upsert({ where: { id: id("notice_house_fire") }, update: {}, create: { id: id("notice_house_fire"), source: "[DEMO] Vecina por llamado telefónico", phone: "0000000001", location: "[DEMO] Belgrano 1250, Sampacho", type: "FIRE", priority: "HIGH", notes: "[DEMO] Humo negro saliendo por la ventana del frente. Una persona adulta mayor ya fue evacuada.", referral: "Policía local avisada", receivedAt: ago(1.6), operatorId: member("guardia"), alertId: alert.id, revision: 2 } });
  // F09/D01: solo se convoca a quien estaba disponible; camila (ausente) no recibe la alerta.
  for (const userId of available) {
    await tx.memberNotification.upsert({ where: { dedupeKey: `alert:${alert.id}:${userId}` }, update: {}, create: { id: id(`alert_notice_${userId.slice(8)}`), userId, title: "Nueva alerta operativa: prioridad alta", href: "/alerts", dedupeKey: `alert:${alert.id}:${userId}`, createdAt: ago(1.5) } });
  }
  // Respuestas fijas (decision posterior al cuestionario). nicolas queda convocado sin responder.
  const responses: Array<[string, "GOING" | "NOT_GOING"]> = [["bombero", "GOING"], ["oficial", "GOING"], ["mateo", "GOING"], ["lucia", "GOING"], ["sofia", "NOT_GOING"], ["aspirante", "GOING"]];
  for (const [key, response] of responses) {
    if (!await tx.alertResponse.findUnique({ where: { alertId_userId: { alertId: alert.id, userId: member(key) } } })) await tx.alertResponse.create({ data: { id: id(`response_${key}`), alertId: alert.id, userId: member(key), response, respondedAt: ago(1.4) } });
  }
  const incident = await tx.incident.upsert({ where: { id: id("incident_house_fire") }, update: {}, create: { id: id("incident_house_fire"), alertId: alert.id, title: "[DEMO] Incendio de vivienda en Belgrano 1250", type: "FIRE", description: "[DEMO] Incendio estructural en dormitorio; ataque interior con ERA.", location: "[DEMO] Belgrano 1250, Sampacho", occurredAt: ago(1.5), createdByUserId: member("guardia"), createdAt: ago(1.45) } });
  // Primera salida: falsa salida (regreso sin llegar, sin motivo obligatorio, G12).
  const falseDeparture = await tx.vehicleDeparture.upsert({ where: { id: id("departure_false") }, update: {}, create: { id: id("departure_false"), operationKey: randomUUID(), requestHash: hash(id("mission_false")), assetId: member("asset_0"), departedAt: ago(1.3), returnedAt: ago(1.2), purpose: incident.title, notes: "Salida acreditada desde el seguimiento de la intervencion", createdByUserId: member("lucia"), crew: { create: [{ userId: member("bombero"), isLeader: false }, { userId: member("oficial"), isLeader: true }] } } });
  await tx.missionMovement.upsert({ where: { id: id("mission_false") }, update: {}, create: { id: id("mission_false"), incidentId: incident.id, assetId: member("asset_0"), driverUserId: member("bombero"), leaderUserId: member("oficial"), createdByUserId: member("lucia"), departedAt: ago(1.3), returnedAt: ago(1.2), returnWithoutArrivalReason: "", departureId: falseDeparture.id, crew: { create: [{ userId: member("bombero") }, { userId: member("oficial") }] } } });
  // Segunda salida: el mismo movil vuelve a salir, llega y sigue en el lugar (movil fuera).
  if (!await tx.missionMovement.findUnique({ where: { id: id("mission_active") } }) && !await tx.missionMovement.findFirst({ where: { assetId: member("asset_0"), returnedAt: null } })) {
    await tx.missionMovement.create({ data: { id: id("mission_active"), incidentId: incident.id, assetId: member("asset_0"), driverUserId: member("bombero"), leaderUserId: member("oficial"), createdByUserId: member("lucia"), departedAt: ago(1.1), arrivedAt: ago(0.9), crew: { create: [{ userId: member("bombero") }, { userId: member("oficial") }, { userId: member("mateo") }] } } });
  }
  await tx.incidentVehicle.upsert({ where: { incidentId_assetId: { incidentId: incident.id, assetId: member("asset_0") } }, update: {}, create: { id: id("incident_vehicle"), incidentId: incident.id, assetId: member("asset_0") } });
  for (const key of ["bombero", "oficial", "mateo"]) await tx.incidentAssignment.upsert({ where: { incidentId_userId: { incidentId: incident.id, userId: member(key) } }, update: {}, create: { id: id(`incident_assignment_${key}`), incidentId: incident.id, userId: member(key) } });
  // Planilla abierta, completada por quien quedo en el cuartel con QR (lucia).
  await tx.incidentSheet.upsert({ where: { incidentId: incident.id }, update: {}, create: { incidentId: incident.id, authorId: member("lucia"), callerName: "[DEMO] Vecina por llamado telefónico", callerPhone: "0000000001", notes: "[DEMO] Primera salida regresó antes de llegar por cambio de acceso; segunda salida en el lugar con ataque interior.", baseUserIds: [member("lucia")], materials: [{ name: "Manga 45mm x 25m", quantity: 2, notes: "En uso" }], evidenceUrls: [] } });
  await tx.incidentNotebookEntry.upsert({ where: { id: id("notebook_arrival") }, update: {}, create: { id: id("notebook_arrival"), incidentId: incident.id, category: "PLACE", title: "[DEMO] Arribo al lugar", body: "[DEMO] Se emplaza el Móvil 14 sobre Belgrano. Fuego confinado a un dormitorio.", occurredAt: ago(0.9), authorUserId: member("oficial") } });

  // ---------------------------------------------------------------------------
  // 7. Intervencion anulada y rehecha (G15).
  // ---------------------------------------------------------------------------
  const original = await tx.incident.upsert({ where: { id: id("incident_voided") }, update: {}, create: { id: id("incident_voided"), title: "[DEMO] Rescate de animal en altura", type: "RESCUE", description: "[DEMO] Planilla cargada con horarios equivocados.", location: "[DEMO] Plaza principal", status: "CLOSED", occurredAt: ago(120), closedAt: ago(117), closedByUserId: member("subjefe"), closingReport: "[DEMO] Cierre con datos que luego se detectaron erróneos", createdByUserId: member("guardia"), voidedAt: ago(100), voidReason: "[DEMO] Horarios de salida y retorno cargados con un día de diferencia" } });
  await tx.incident.upsert({ where: { id: id("incident_redo") }, update: {}, create: { id: id("incident_redo"), title: original.title, type: original.type, description: original.description, location: original.location, occurredAt: original.occurredAt, createdByUserId: member("subjefe"), replacesIncidentId: original.id, createdAt: ago(100) } });
  await audit("incident_voided", "subjefe", "INCIDENT_VOIDED_FOR_REDO", "Incident", original.id, { reason: original.voidReason, replacementIncidentId: id("incident_redo"), voidedDepartures: [] }, ago(100));

  // ---------------------------------------------------------------------------
  // 8. Guardias: intercambios en distintos estados (M02).
  // ---------------------------------------------------------------------------
  const swappable = async (fromKey: string, toKey: string) => tx.shift.findFirst({ where: { date: { gte: new Date(clock.getTime() + 3 * 86400000) }, assignments: { some: { userId: member(fromKey) }, none: { userId: member(toKey) } } }, orderBy: { date: "asc" }, select: { id: true } });
  const swaps: Array<[string, string, string, "PENDING" | "ACCEPTED" | "REJECTED", string]> = [
    ["swap_pending", "bombero", "nicolas", "PENDING", "[DEMO] Viaje familiar programado"],
    ["swap_accepted", "sofia", "lucia", "ACCEPTED", "[DEMO] Turno médico que no se puede reprogramar"],
    ["swap_rejected", "camila", "mateo", "REJECTED", "[DEMO] Compromiso laboral"],
  ];
  for (const [key, fromKey, toKey, status, reason] of swaps) {
    if (await tx.shiftSwapRequest.findUnique({ where: { id: id(key) } })) continue;
    const shift = await swappable(fromKey, toKey);
    if (!shift) continue;
    await tx.shiftSwapRequest.create({ data: { id: id(key), shiftId: shift.id, fromUserId: member(fromKey), toUserId: member(toKey), reason, status, createdAt: ago(20), ...(status === "ACCEPTED" ? { acceptedAt: ago(10) } : {}), ...(status === "REJECTED" ? { decidedAt: ago(8) } : {}) } });
  }

  // ---------------------------------------------------------------------------
  // 9. Tareas: transferencia pendiente, "No puedo" y tarea sin presencia (K02/K06/K07).
  // ---------------------------------------------------------------------------
  const due = (days: number) => new Date(new Date(clock.getTime() + days * 86400000).toISOString().slice(0, 10));
  await tx.workTask.upsert({ where: { id: id("task_transfer") }, update: {}, create: { id: id("task_transfer"), title: "[DEMO] Revisar extintores del salón", description: "Verificar carga y precinto de los 4 extintores del salón de usos múltiples.", dueOn: due(5), createdByUserId: member("subjefe"), createdAt: ago(48), members: { create: { userId: member("bombero") } } } });
  await tx.workTaskTransfer.upsert({ where: { id: id("transfer_pending") }, update: {}, create: { id: id("transfer_pending"), taskId: id("task_transfer"), fromUserId: member("bombero"), toUserId: member("camila"), notes: "[DEMO] Esta semana tengo guardia doble; Camila conoce los extintores", createdAt: ago(6) } });
  await tx.workTaskEvent.upsert({ where: { id: id("event_transfer") }, update: {}, create: { id: id("event_transfer"), taskId: id("task_transfer"), actorUserId: member("bombero"), action: "TRANSFER_REQUESTED", notes: "Propuesta de transferencia a Camila", createdAt: ago(6) } });
  await tx.workTask.upsert({ where: { id: id("task_declined") }, update: {}, create: { id: id("task_declined"), title: "[DEMO] Ordenar la baulera de herramientas", description: "Reordenar herramientas manuales por tipo y rotular estantes.", dueOn: due(4), createdByUserId: member("operador"), createdAt: ago(60), members: { create: { userId: member("mateo"), declinedAt: ago(20) } } } });
  await tx.workTaskEvent.upsert({ where: { id: id("event_declined") }, update: {}, create: { id: id("event_declined"), taskId: id("task_declined"), actorUserId: member("mateo"), action: "DECLINE", notes: "[DEMO] Lesión en la mano; no puedo cargar peso esta semana", createdAt: ago(20) } });
  await tx.workTask.upsert({ where: { id: id("task_remote") }, update: {}, create: { id: id("task_remote"), title: "[DEMO] Actualizar el directorio de contactos", description: "Revisar teléfonos de hospital, policía y defensa civil; no requiere estar en el cuartel.", dueOn: due(7), requiresPresence: false, createdByUserId: member("oficial"), createdAt: ago(24) } });

  // ---------------------------------------------------------------------------
  // 10. EPP institucional entregado y pendiente de aceptacion del titular (P04).
  // ---------------------------------------------------------------------------
  await tx.asset.upsert({ where: { id: id("ppe_helmet_asset") }, update: {}, create: { id: id("ppe_helmet_asset"), name: "[DEMO] Casco estructural MSA Cairns", assetType: "PPE", status: "OPERATIONAL", lastCheckDate: ago(30) } });
  await tx.personalEquipment.upsert({ where: { id: id("ppe_helmet") }, update: {}, create: { id: id("ppe_helmet"), assetId: id("ppe_helmet_asset"), code: "BVS-EPP-901", category: "HELMET", size: "M" } });
  await tx.personalEquipmentCheck.upsert({ where: { id: id("ppe_helmet_check") }, update: {}, create: { id: id("ppe_helmet_check"), equipmentId: id("ppe_helmet"), checkedByUserId: member("lucia"), condition: "OK", notes: "[DEMO] Barbijo y visor en condiciones", checkedAt: ago(30) } });
  if (!await tx.personalEquipmentIssue.findFirst({ where: { equipmentId: id("ppe_helmet"), returnedAt: null } })) await tx.personalEquipmentIssue.create({ data: { id: id("ppe_helmet_issue"), equipmentId: id("ppe_helmet"), userId: member("mateo"), issuedByUserId: member("lucia"), issuedAt: ago(4), issueNotes: "[DEMO] Reemplazo del casco con visor rayado" } });
  await tx.memberNotification.upsert({ where: { dedupeKey: id("ppe_helmet_notice") }, update: {}, create: { id: id("ppe_helmet_notice"), userId: member("mateo"), title: "Confirme la recepción de [DEMO] Casco estructural MSA Cairns", href: "/me", dedupeKey: id("ppe_helmet_notice"), createdAt: ago(4) } });

  // ---------------------------------------------------------------------------
  // 11. Comunicacion que exige confirmar lectura (N03/N06): publicada hace mas de 24 h.
  // ---------------------------------------------------------------------------
  await tx.chatMessage.upsert({ where: { id: id("message_era") }, update: {}, create: { id: id("message_era"), authorUserId: member("subjefe"), body: "[DEMO] A partir de hoy el uso de ERA es obligatorio en todo ataque interior, sin excepción. Confirmen la lectura.", isPinned: true, createdAt: ago(30) } });

  await tx.auditLog.upsert({ where: { id: id("marker") }, update: {}, create: { id: id("marker"), action: "SYSTEM_DEMO_QUESTIONNAIRE_SEEDED", entityType: "System", entityId: "demo-v4", metadata: { synthetic: true, version: 4 }, createdAt: clock } });
  return { ...summary, convocados: available.length, primeraVez: firstRun ? "sí" : "no" };
}
