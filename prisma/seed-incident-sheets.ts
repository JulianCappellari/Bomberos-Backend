import { createHash } from "node:crypto";
import { AlertType, Prisma } from "@prisma/client";
import { finalizeSheet } from "../src/modules/incidents/incident-sheet";
import { stationDate } from "../src/utils/station-time";

const user = (key: string) => `demo_v2_${key}`;
const id = (key: string) => user(`sheet_${key}`);

export async function seedCompleteIncidentSheets(tx: Prisma.TransactionClient, reference: Date) {
  const cases: Array<{ key: string; type: AlertType; title: string; days: number; author: string; closed: boolean; notes: string }> = [
    { key: "fire", type: "FIRE", title: "Incendio de vivienda - planilla completa", days: 40, author: "admin", closed: true,
      notes: "SIMULACRO. Reconocimiento de vivienda evacuada; despliegue de dos lineas de ataque, corte preventivo de energia y ventilacion. Se extinguio el foco y se revisaron puntos calientes. Se contabilizaron personal y materiales antes del retorno. Sin victimas ni danos reales." },
    { key: "rescue", type: "RESCUE", title: "Rescate en altura - planilla completa", days: 38, author: "oficial", closed: true,
      notes: "SIMULACRO. Aseguramiento de zona y anclajes, instalacion de sistema de rescate y descenso controlado de maniqui. Se verificaron cuerdas, arneses y conectores al terminar. Personal y material regresaron completos; sin intervencion sobre personas reales." },
    { key: "accident", type: "ACCIDENT", title: "Accidente vehicular - planilla completa", days: 36, author: "subjefe", closed: true,
      notes: "SIMULACRO. Senalizacion del perimetro, estabilizacion de vehiculo de entrenamiento, evaluacion primaria y extricacion de maniqui. Coordinacion ficticia con servicio sanitario y policia. Retiro de herramientas y liberacion de la zona una vez verificado el retorno de toda la dotacion." },
    { key: "ready", type: "OTHER", title: "Servicio completo pendiente de cierre", days: 34, author: "oficial", closed: false,
      notes: "SIMULACRO. Asistencia preventiva de entrenamiento finalizada. Dotacion retornada, material revisado y personal en base registrado. La planilla esta completa para practicar el cierre por administrador u oficial sin QR; redactarla no acredita asistencia de su autor." },
  ];
  const station = await tx.station.findUniqueOrThrow({ where: { id: user("central") } });
  for (const [index, scenario] of cases.entries()) {
    const incidentId = id(scenario.key);
    // One atomic scenario: never recreate its crew or undo edits on a rerun.
    if (await tx.incident.findUnique({ where: { id: incidentId }, select: { id: true } })) continue;
    const date = stationDate(new Date(+reference - scenario.days * 86400000));
    const at = (hour: number, minute = 0) => new Date(`${date}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00-03:00`);
    const alertId = id(`alert_${scenario.key}`), location = `[DEMO] Predio de entrenamiento, sector ${index + 1}`;
    await tx.alert.create({ data: { id: alertId, type: scenario.type, priority: "MEDIUM", location,
      description: `[DEMO] ${scenario.title}. Ejercicio sintetico, no despachar recursos reales.`, contactPhone: "0000000000", createdByUserId: user("guardia"), createdAt: at(14, 2) } });
    await tx.dispatchNotice.create({ data: { id: id(`notice_${scenario.key}`), alertId, operatorId: user("guardia"), receivedAt: at(14),
      source: "[DEMO] Instructor de entrenamiento", phone: "0000000000", type: scenario.type, priority: "MEDIUM", location,
      notes: "Solicitud ficticia recibida por telefono de practica. No llamar ni enviar recursos.", referral: "Coordinacion de entrenamiento" } });
    await tx.incident.create({ data: { id: incidentId, alertId, title: `[DEMO] ${scenario.title}`, type: scenario.type,
      description: scenario.notes, location, occurredAt: at(14, 3), createdAt: at(14, 3), createdByUserId: user("guardia"), responseTimeMinutes: 12 } });
    const crew = ["bombero", "sofia"], baseUserId = user("lucia");
    for (const key of [...crew, "lucia"]) {
      await tx.alertResponse.create({ data: { id: id(`response_${scenario.key}_${key}`), alertId, userId: user(key), response: "GOING", respondedAt: at(14, 4) } });
      await tx.incidentAssignment.create({ data: { id: id(`assignment_${scenario.key}_${key}`), incidentId, userId: user(key), assignedAt: at(14, 5) } });
    }
    // An official may author the sheet without joining the service or changing this response.
    await tx.alertResponse.create({ data: { id: id(`not_going_${scenario.key}`), alertId, userId: user("oficial"), response: "NOT_GOING", respondedAt: at(14, 4) } });
    const qrId = id(`qr_${scenario.key}`);
    await tx.qrChallenge.create({ data: { id: qrId, stationId: station.id, tokenHash: createHash("sha256").update(qrId).digest("hex"),
      createdByUserId: user("guardia"), createdAt: at(13, 59), expiresAt: at(14), revokedAt: at(14, 1), consumedCount: 1 } });
    await tx.attendance.create({ data: { id: id(`presence_${scenario.key}`), userId: baseUserId, stationId: station.id,
      checkInQrId: qrId, checkInAt: at(13, 59), checkOutAt: at(16, 15), workedMinutes: 136, status: "CLOSED",
      checkInTrust: "HIGH", checkOutTrust: "HIGH", checkInLatitude: station.latitude, checkInLongitude: station.longitude,
      checkInAccuracy: 10, checkInDevice: "DEMO-HISTORICO-PLANILLA" } });
    const departureId = id(`departure_${scenario.key}`), movementId = id(`movement_${scenario.key}`), assetId = user("asset_0");
    await tx.vehicleDeparture.create({ data: { id: departureId, operationKey: `00000000-0000-4000-b000-${String(index + 1).padStart(12, "0")}`,
      requestHash: createHash("sha256").update(departureId).digest("hex"), assetId, departedAt: at(14, 8), returnedAt: at(16),
      purpose: `[DEMO] ${scenario.title}`, notes: "Salida sintetica; conductor Bombero y responsable Sofia, ambos en la dotacion.", createdByUserId: user("guardia"), createdAt: at(16),
      crew: { create: crew.map(key => ({ userId: user(key), isLeader: key === "sofia" })) } } });
    await tx.missionMovement.create({ data: { id: movementId, incidentId, assetId, departureId, driverUserId: user("bombero"), leaderUserId: user("sofia"),
      createdByUserId: user("guardia"), departedAt: at(14, 8), arrivedAt: at(14, 15), returnedAt: at(16), crew: { create: crew.map(key => ({ userId: user(key) })) } } });
    await tx.incidentVehicle.create({ data: { id: id(`vehicle_${scenario.key}`), incidentId, assetId } });
    await tx.incidentSheet.create({ data: { incidentId, authorId: user(scenario.author), callerName: "[DEMO] Instructor de entrenamiento", callerPhone: "0000000000",
      notes: scenario.notes, baseUserIds: [baseUserId], materials: [
        { name: scenario.type === "RESCUE" ? "Cuerda de entrenamiento" : "Manga 45mm", quantity: 2, notes: "Retornadas y revisadas; registro sintetico" },
        { name: "Conos de senalizacion", quantity: 4, notes: "Retornados completos" },
      ], evidenceUrls: [], createdAt: at(16, 5) } });
    await tx.incidentNotebookEntry.create({ data: { id: id(`note_${scenario.key}`), incidentId, category: "NOTE", title: "[DEMO] Verificacion de retorno",
      body: "Personal y materiales de entrenamiento contabilizados. No se detectaron novedades en la revision del retorno.", authorUserId: user("guardia"), occurredAt: at(16, 1), createdAt: at(16, 1) } });
    if (scenario.closed) {
      await finalizeSheet(tx, incidentId, at(16, 10), user(scenario.author));
      await tx.incident.update({ where: { id: incidentId }, data: { status: "CLOSED", closedAt: at(16, 10), closedByUserId: user(scenario.author), closingReport: "SIMULACRO CERRADO. Dotacion retornada, materiales revisados y planilla completa. Sin victimas reales." } });
      await tx.alert.update({ where: { id: alertId }, data: { status: "RESOLVED", resolvedAt: at(16, 10), resolvedByUserId: user(scenario.author) } });
      for (const key of [...crew, "lucia"]) await tx.serviceParticipation.create({ data: {
        id: id(`participation_${scenario.key}_${key}`), userId: user(key), incidentId, startedAt: at(14, key === "lucia" ? 3 : 8), endedAt: at(16),
        registeredByUserId: user(scenario.author), verifiedAt: at(16, 10), createdAt: at(16, 10), notes: "Participacion historica sintetica; el autor no recibe asistencia por redactar la planilla" } });
    }
    await tx.auditLog.create({ data: { id: id(`audit_${scenario.key}`), actorUserId: user(scenario.author), action: "INCIDENT_SHEET_CREATED", entityType: "Incident", entityId: incidentId,
      createdAt: at(16, 5), metadata: { synthetic: true, authorId: user(scenario.author), reason: "Escenario completo de intervencion; autor exceptuado de QR sin acreditar presencia" } } });
  }
}
