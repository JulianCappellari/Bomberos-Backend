import bcrypt from "bcrypt";
import { createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { PUBLIC_USER_SELECT } from "../src/utils/public-user";
import { seedExtendedScenarios } from "./seed-scenarios";
import { assertDemoOnly } from "./seed-safety";
import { resetDemoCredentials } from "./demo-credentials";
import { seedCurrentRules } from "./seed-current-rules";
import { seedQuestionnaireScenarios } from "./seed-questionnaire";
import { seedProfessionalScenarios } from "./seed-professional-scenarios";
import { seedCompleteIncidentSheets } from "./seed-incident-sheets";

const id = (name: string) => `demo_v2_${name}`;

function scenarioDay(offset: number, reference: Date) {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "America/Argentina/Cordoba",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(reference);

  const part = (name: string) => parts.find((p) => p.type === name)!.value;
  const date = new Date(`${part("year")}-${part("month")}-${part("day")}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date;
}

export async function seedDemo(client: PrismaClient, password: string, options: { resetPasswords?: boolean } = {}) {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Seed demo prohibido en producción");
  }
  if (password.length < 12 || Buffer.byteLength(password) > 72) {
    throw new Error("SEED_PASSWORD requiere al menos 12 caracteres y hasta 72 bytes");
  }

  const previousClock = await client.auditLog.findUnique({ where: { id: id("extended_clock") }, select: { createdAt: true } });
  const reference = previousClock?.createdAt || new Date();
  const day = (offset: number) => scenarioDay(offset, reference);
  const passwordHash = await bcrypt.hash(password, 12);

  return client.$transaction(
    async (tx) => {
      // -----------------------------------------------------------------------
      // 0. Safeguard: en producción o si se activa modo estricto
      // -----------------------------------------------------------------------
      const [database] = await tx.$queryRaw<Array<{ schema: string }>>`SELECT current_schema() AS schema`;
      if (!database || !/^bomberos_demo(?:_[a-z0-9_]{1,32})?$/.test(database.schema)) throw new Error("Seed permitido solo en un esquema bomberos_demo; use npm run seed:demo");
      await assertDemoOnly(tx);

      // -----------------------------------------------------------------------
      // 1. Dotación y Usuarios (Escalafón Bomberos Sampacho)
      // -----------------------------------------------------------------------
      const roster = [
        {
          key: "admin",
          username: "demo.admin",
          email: "jefatura@bomberossampacho.org.ar",
          fullName: "Comandante Mayor Juan Carlos Morales",
          role: "ADMIN" as const,
          rank: "Administrador",
          badge: "BVS-001",
          dni: "24.819.302",
          phone: "03582-421101",
          bloodType: "0+",
          address: "San Martín 640, Sampacho",
          emergencyName: "Marta Rodríguez (Esposa)",
          emergencyPhone: "03582-15498821",
          emergencyRel: "Cónyuge",
          isActive: true,
          isPending: false,
        },
        {
          key: "subjefe",
          username: "demo.subjefe",
          email: "sub_jefatura@bomberossampacho.org.ar",
          fullName: "Comisario Inspector Marcelo Gómez",
          role: "ADMIN" as const,
          rank: "Oficial",
          badge: "BVS-004",
          dni: "28.391.044",
          phone: "03582-421255",
          bloodType: "A+",
          address: "Hipólito Yrigoyen 312, Sampacho",
          emergencyName: "Patricia Ferreyra (Esposa)",
          emergencyPhone: "03582-15410933",
          emergencyRel: "Cónyuge",
          isActive: true,
          isPending: false,
        },
        {
          key: "operador",
          username: "demo.operador",
          email: "central@bomberossampacho.org.ar",
          fullName: "Sargento 1º Lucas Fernández",
          role: "OPERATOR" as const,
          rank: "Sub oficial",
          badge: "BVS-012",
          dni: "33.450.912",
          phone: "03582-15488102",
          bloodType: "B+",
          address: "Belgrano 180, Sampacho",
          emergencyName: "Carlos Fernández (Padre)",
          emergencyPhone: "03582-15409112",
          emergencyRel: "Padre",
          isActive: true,
          isPending: false,
        },
        {
          key: "oficial",
          username: "demo.oficial",
          email: "eramos@bomberossampacho.org.ar",
          fullName: "Oficial Principal Esteban Ramos",
          role: "FIREFIGHTER" as const,
          rank: "Oficial",
          badge: "BVS-008",
          dni: "31.204.881",
          phone: "03582-15433299",
          bloodType: "0+",
          address: "Av. 9 de Julio 720, Sampacho",
          emergencyName: "Lucía Ramos (Hermana)",
          emergencyPhone: "03582-15490214",
          emergencyRel: "Hermana",
          isActive: true,
          isPending: false,
        },
        {
          key: "bombero",
          username: "demo.bombero",
          email: "mcastro@bomberossampacho.org.ar",
          fullName: "Bombero Matías Castro",
          role: "FIREFIGHTER" as const,
          rank: "Bombero",
          badge: "BVS-019",
          dni: "36.781.233",
          phone: "03582-15477218",
          bloodType: "0-",
          address: "Rivadavia 415, Sampacho",
          emergencyName: "Estela Gómez (Madre)",
          emergencyPhone: "03582-15411899",
          emergencyRel: "Madre",
          isActive: true,
          isPending: false,
        },
        {
          key: "sofia",
          username: "demo.sofia",
          email: "snavarro@bomberossampacho.org.ar",
          fullName: "Bombero Sofía Navarro",
          role: "FIREFIGHTER" as const,
          rank: "Bombero",
          badge: "BVS-023",
          dni: "38.990.114",
          phone: "03582-15499104",
          bloodType: "A-",
          address: "Bv. Sarmiento 230, Sampacho",
          emergencyName: "Jorge Navarro (Padre)",
          emergencyPhone: "03582-15422819",
          emergencyRel: "Padre",
          isActive: true,
          isPending: false,
        },
        {
          key: "nicolas",
          username: "demo.nicolas",
          email: "nrossi@bomberossampacho.org.ar",
          fullName: "Bombero Nicolás Rossi",
          role: "FIREFIGHTER" as const,
          rank: "Bombero",
          badge: "BVS-027",
          dni: "40.123.456",
          phone: "03582-15488277",
          bloodType: "0+",
          address: "Sucre 145, Sampacho",
          emergencyName: "Mariela Rossi (Hermana)",
          emergencyPhone: "03582-15433811",
          emergencyRel: "Hermana",
          isActive: true,
          isPending: false,
        },
        {
          key: "camila",
          username: "demo.camila",
          email: "cdiaz@bomberossampacho.org.ar",
          fullName: "Bombero Camila Díaz",
          role: "FIREFIGHTER" as const,
          rank: "Bombero",
          badge: "BVS-031",
          dni: "39.400.812",
          phone: "03582-15400234",
          bloodType: "AB+",
          address: "Moreno 580, Sampacho",
          emergencyName: "Roberto Díaz (Padre)",
          emergencyPhone: "03582-15411782",
          emergencyRel: "Padre",
          isActive: true,
          isPending: false,
        },
        {
          key: "aspirante",
          username: "demo.aspirante",
          email: "fvega@bomberossampacho.org.ar",
          fullName: "Aspirante Franco Vega",
          role: "FIREFIGHTER" as const,
          rank: "Aspirante Mayor",
          badge: "ASP-005",
          dni: "43.512.901",
          phone: "03582-15419920",
          bloodType: "0+",
          address: "Italia 820, Sampacho",
          emergencyName: "Silvia Vega (Madre)",
          emergencyPhone: "03582-15488192",
          emergencyRel: "Madre",
          isActive: true,
          isPending: false,
        },
        {
          key: "inactivo",
          username: "demo.inactivo",
          email: "inactivo@demo.invalid",
          fullName: "Bombero Reserva Diego Luna",
          role: "FIREFIGHTER" as const,
          rank: "Bombero",
          badge: "BVS-014",
          dni: "34.112.890",
          phone: "03582-15433211",
          bloodType: "A+",
          address: "Sampacho",
          emergencyName: "Contacto de Reserva",
          emergencyPhone: "03582-000000",
          emergencyRel: "Familiar",
          isActive: false,
          isPending: false,
        },
        {
          key: "pendiente",
          username: "demo.pendiente",
          email: "pendiente@demo.invalid",
          fullName: "Aspirante en Evaluación Martín Sosa",
          role: "FIREFIGHTER" as const,
          rank: "Aspirante mayor",
          badge: "ASP-011",
          dni: "45.109.822",
          phone: "03582-15499211",
          bloodType: "0+",
          address: "Sampacho",
          emergencyName: "Contacto Postulante",
          emergencyPhone: "03582-000000",
          emergencyRel: "Familiar",
          isActive: true,
          isPending: true,
        },
        {
          key: "guardia", username: "demo.guardia", email: "guardia@demo.invalid",
          fullName: "Guardia de demostracion", role: "GUARD" as const, rank: "Guardia",
          badge: "DEMO-GUARDIA", dni: "DEMO-GUARDIA", phone: "000000000",
          bloodType: "O+", address: "Base de demostracion",
          emergencyName: "Contacto ficticio", emergencyPhone: "000000000",
          emergencyRel: "Familiar", isActive: true, isPending: false,
        },
      ];

      for (const person of roster) {
        await tx.user.upsert({
          where: { id: id(person.key) },
          update: {},
          create: {
            id: id(person.key),
            username: person.username,
            email: `${person.key}@bomberos.demo.invalid`,
            passwordHash,
            role: person.role,
            isActive: person.isActive,
            isPendingApproval: person.isPending,
            profile: {
              create: {
                fullName: `[DEMO] ${person.fullName}`,
                rank: person.rank,
                badge: person.badge,
                dni: `DEMO-${person.key}`,
                phone: "0000000000",
                bloodType: person.bloodType.replace(/^0/, "O"),
                address: "Domicilio ficticio de demostracion",
                joinDate: day(-730),
                birthDate: day(-365 * (person.key === "aspirante" ? 20 : 30 + roster.findIndex((row) => row.key === person.key)) - 17 * roster.findIndex((row) => row.key === person.key)),
              },
            },
            emergencyContact: {
              create: {
                fullName: `[DEMO] ${person.emergencyName}`,
                phone: "0000000000",
                relationship: person.emergencyRel,
              },
            },
          },
        });
      }

      for (const [index, keys] of [["oficial", "bombero", "sofia", "aspirante"], ["subjefe", "operador", "nicolas", "camila", "guardia"]].entries()) {
        const group = await tx.controlGroup.upsert({ where: { id: id(`control_group_${index}`) }, update: {}, create: { id: id(`control_group_${index}`), name: `Grupo demo ${index + 1}`, startsOn: day(-1 + index * 7), repeatWeeks: 2 } });
        for (const key of keys) {
          if (!await tx.controlGroupMember.findUnique({ where: { userId: id(key) } })) await tx.controlGroupMember.create({ data: { groupId: group.id, userId: id(key) } });
        }
      }
      await tx.personalDeclaration.upsert({ where: { id: id("personal_clothing") }, update: {}, create: { id: id("personal_clothing"), userId: id("bombero"), category: "CLOTHING", title: "Chaqueton de demostracion", details: "Ejemplo ficticio de declaracion personal", clothingBrand: "Demo", clothingModel: "Ejemplo", clothingSize: "L", clothingCondition: "OK", clothingNovelties: "Sin novedades ficticias" } });

      // -----------------------------------------------------------------------
      // 2. Cuarteles y Puestos Operativos
      // -----------------------------------------------------------------------
      await tx.station.upsert({
        where: { id: id("central") },
        update: {},
        create: {
          id: id("central"),
          name: "Cuartel Central Sampacho",
          latitude: -33.3831,
          longitude: -64.7214,
          radiusMeters: 80,
        },
      });

      await tx.station.upsert({
        where: { id: id("anexo") },
        update: {},
        create: {
          id: id("anexo"),
          name: "Destacamento Puesto Ruta 8",
          latitude: -33.3910,
          longitude: -64.7080,
          radiusMeters: 60,
        },
      });

      // -----------------------------------------------------------------------
      // 3. Fichadas de Asistencia (Guardia activa y registros del mes)
      // -----------------------------------------------------------------------
      const demoEntryAt = new Date(Date.now() - 45 * 60000);
      await tx.qrChallenge.upsert({ where: { id: id("expired_entry_qr") }, update: {}, create: { id: id("expired_entry_qr"), stationId: id("central"), tokenHash: createHash("sha256").update("DEMO-EXPIRED-ENTRY-NOT-ACTIVE").digest("hex"), createdByUserId: id("guardia"), createdAt: new Date(demoEntryAt.getTime() - 15000), expiresAt: new Date(demoEntryAt.getTime() + 45000), revokedAt: new Date(), consumedCount: 1 } });
      // Bombero en cuartel actualmente (Status OPEN)
      await tx.attendance.upsert({
        where: { id: id("present") },
        update: {},
        create: {
          id: id("present"),
          userId: id("operador"),
          stationId: id("central"),
          status: "OPEN",
          checkInAt: new Date(),
          checkInTrust: "HIGH",
          checkInDevice: "DEMO-TERMINAL-GUARDIA",
        },
      });

      await tx.attendance.upsert({
        where: { id: id("present_matias") },
        update: {},
        create: {
          id: id("present_matias"),
          userId: id("bombero"),
          stationId: id("central"),
          checkInQrId: id("expired_entry_qr"),
          status: "OPEN",
          checkInAt: demoEntryAt,
          checkInLatitude: -33.3831,
          checkInLongitude: -64.7214,
          checkInAccuracy: 10,
          checkInTrust: "HIGH",
          checkInDevice: "DEMO-MOVIL-APP",
        },
      });

      // Asistencias históricas cerradas (acumulan horas del mes)
      const pastAttendances = [
        { user: "oficial", offset: -3, hours: 6 },
        { user: "bombero", offset: -2, hours: 8 },
        { user: "sofia", offset: -1, hours: 5 },
        { user: "nicolas", offset: -4, hours: 7 },
        { user: "camila", offset: -2, hours: 4 },
        { user: "aspirante", offset: -1, hours: 3 },
      ];

      for (const [idx, item] of pastAttendances.entries()) {
        const checkInAt = new Date(day(item.offset).getTime() + 10 * 3600000);
        const checkOutAt = new Date(checkInAt.getTime() + item.hours * 3600000);
        const attId = id(`attendance_${item.user}_${idx}`);

        await tx.attendance.upsert({
          where: { id: attId },
          update: {},
          create: {
            id: attId,
            userId: id(item.user),
            stationId: id("central"),
            status: "CLOSED",
            checkInAt,
            checkOutAt,
            workedMinutes: item.hours * 60,
            checkInTrust: "HIGH",
            checkOutTrust: "HIGH",
            checkInDevice: "DEMO-QR",
          },
        });

        await tx.attendanceRecord.upsert({
          where: { id: id(`legacy_${item.user}_${idx}`) },
          update: {},
          create: {
            id: id(`legacy_${item.user}_${idx}`),
            userId: id(item.user),
            type: "ENTRY",
            method: "QR",
            recordedAt: checkInAt,
            recordedByUserId: id("admin"),
            notes: "Guardia operativa registrada",
          },
        });
        await tx.attendanceRecord.upsert({ where: { id: id(`legacy_exit_${item.user}_${idx}`) }, update: {}, create: { id: id(`legacy_exit_${item.user}_${idx}`), userId: id(item.user), type: "EXIT", method: "QR", recordedAt: checkOutAt, recordedByUserId: id("admin"), notes: "DEMO: salida historica pareada con el ingreso" } });
      }

      // -----------------------------------------------------------------------
      // 4. Guardias y Disponibilidad de Dotación
      // -----------------------------------------------------------------------
      for (const period of ["DAY", "NIGHT"] as const) {
        const shiftId = id(`shift_${period}`);
        await tx.shift.upsert({
          where: { id: shiftId },
          update: {},
          create: {
            id: shiftId,
            date: day(1),
            period,
            startTime: period === "DAY" ? "08:00" : "20:00",
            endTime: period === "DAY" ? "20:00" : "08:00",
            shiftType: period === "DAY" ? "Guardia Diurna Central" : "Guardia Nocturna Central",
            createdByUserId: id("admin"),
            notes: "Guardia de primer despacho y patrullaje preventivo",
          },
        });

        const assignedUsers =
          period === "DAY"
            ? ["oficial", "bombero", "sofia"]
            : ["operador", "nicolas", "aspirante"];

        for (const name of assignedUsers) {
          await tx.shiftAssignment.upsert({
            where: { shiftId_userId: { shiftId, userId: id(name) } },
            update: {},
            create: { shiftId, userId: id(name) },
          });

          await tx.personnelAvailability.upsert({
            where: {
              userId_date_period: { userId: id(name), date: day(1), period },
            },
            update: {},
            create: {
              userId: id(name),
              date: day(1),
              period,
              status: "AVAILABLE",
              editedByUserId: id("admin"),
            },
          });
        }
      }

      // Guardia de ayer (para actas y reportes)
      const pastShiftId = id("past_shift");
      await tx.shift.upsert({
        where: { id: pastShiftId },
        update: {},
        create: {
          id: pastShiftId,
          date: day(-1),
          period: "DAY",
          startTime: "08:00",
          endTime: "20:00",
          shiftType: "Guardia Diurna Central",
          createdByUserId: id("admin"),
        },
      });

      await tx.shiftAssignment.upsert({
        where: { shiftId_userId: { shiftId: pastShiftId, userId: id("oficial") } },
        update: {},
        create: { shiftId: pastShiftId, userId: id("oficial") },
      });

      // -----------------------------------------------------------------------
      // 5. Parque Automotor Realista de Bomberos Sampacho
      // -----------------------------------------------------------------------
      const fleet = [
        {
          index: 0,
          name: "Móvil 14 - Autobomba Pesada Mercedes Atego",
          unitNumber: "M-14",
          plate: "AD-123-BC",
          year: 2021,
          mileage: 42500,
          status: "OPERATIONAL" as const,
          notes: "Autobomba urbana pesada. Tanque 4.000 L, bomba Rosenbauer NH30.",
        },
        {
          index: 1,
          name: "Móvil 8 - Rescate y Trauma Iveco Daily 4x4",
          unitNumber: "M-8",
          plate: "AE-456-XY",
          year: 2022,
          mileage: 28300,
          status: "OPERATIONAL" as const,
          notes: "Unidad de rescate vehicular con herramientas hidráulicas y trauma.",
        },
        {
          index: 2,
          name: "Móvil 21 - Camión Cisterna Scania P310",
          unitNumber: "M-21",
          plate: "AF-789-JK",
          year: 2019,
          mileage: 64100,
          status: "OPERATIONAL" as const,
          notes: "Cisterna de abastecimiento con tanque de 15.000 Litros de agua.",
        },
        {
          index: 3,
          name: "Móvil 4 - Forestal Rápido Toyota Hilux 4x4",
          unitNumber: "M-4",
          plate: "AG-012-MN",
          year: 2023,
          mileage: 18200,
          status: "OPERATIONAL" as const,
          notes: "Kit forestal de 600 L, bomba Honda alta presión y espumígeno.",
        },
        {
          index: 4,
          name: "Móvil 2 - Logística Renault Master Furgón",
          unitNumber: "M-2",
          plate: "AC-987-OP",
          year: 2018,
          mileage: 115000,
          status: "MAINTENANCE" as const,
          notes: "En taller por recambio de pastillas de freno y bomba de embrague.",
        },
        {
          index: 5,
          name: "Móvil 1 - Autobomba Histórica Ford F-600",
          unitNumber: "M-1",
          plate: "R-145892",
          year: 1985,
          mileage: 89000,
          status: "OUT_OF_SERVICE" as const,
          notes: "Unidad histórica y ceremonial de desfiles.",
        },
      ];

      for (const vehicleData of fleet) {
        const assetId = id(`asset_${vehicleData.index}`);
        const vehicleId = id(`vehicle_${vehicleData.index}`);
        const compartmentId = id(`compartment_${vehicleData.index}`);
        const inspectionId = id(`inspection_${vehicleData.index}`);

        await tx.asset.upsert({
          where: { id: assetId },
          update: {},
          create: {
            id: assetId,
            name: `[DEMO] ${vehicleData.name}`,
            assetType: "VEHICLE",
            status: vehicleData.status,
            lastCheckDate: day(-1),
            notes: vehicleData.notes,
          },
        });

        await tx.vehicle.upsert({
          where: { id: vehicleId },
          update: {},
          create: {
            id: vehicleId,
            assetId,
            unitNumber: vehicleData.unitNumber,
            kind: ["ENGINE", "RESCUE", "TANKER", "ENGINE", "SUPPORT", "OTHER"][vehicleData.index],
            plate: vehicleData.plate,
            year: vehicleData.year,
            mileage: vehicleData.mileage,
            nextOilChangeMileage: vehicleData.mileage + 10000,
          },
        });

        await tx.vehicleCompartment.upsert({
          where: { id: compartmentId },
          update: {},
          create: {
            id: compartmentId,
            vehicleId,
            name: "Baulera de Primer Ataque y Rescate",
            sortOrder: 1,
          },
        });

        // Inspección reciente
        await tx.inspection.upsert({
          where: { id: inspectionId },
          update: {},
          create: {
            id: inspectionId,
            vehicleId,
            inspectionDate: day(-1),
            inspectionTime: "08:30",
            leaderUserId: id("oficial"),
            createdByUserId: id("admin"),
            resultingAssetStatus: vehicleData.status,
            summaryOk: vehicleData.status === "MAINTENANCE" ? 2 : 3,
            summaryMissing: 0,
            summaryDamaged: vehicleData.status === "MAINTENANCE" ? 1 : 0,
            observations: `Inspección de rutina para ${vehicleData.name}. Niveles y presiones verificadas.`,
          },
        });

        // Herramientas en el inventario del móvil
        const tools = [
          ["Manga 45mm x 25m", "Lanza regulable", "Bifurcacion de ataque"],
          ["Cizalla hidraulica", "Separador hidraulico", "Kit de estabilizacion"],
          ["Manga de abastecimiento", "Acople de hidrante", "Medidor de nivel"],
          ["Mochila forestal", "Rastrillo forestal", "Batefuego"],
          ["Rueda de auxilio", "Caja de herramientas", "Cinta de sujecion"],
          ["Calza de rueda", "Extintor", "Botiquin de exhibicion"],
        ][vehicleData.index]!;

        for (const [itemIndex, toolName] of tools.entries()) {
          const inventoryItemId = id(`item_${vehicleData.index}_${itemIndex}`);
          const isDamaged = vehicleData.status === "MAINTENANCE" && itemIndex === 2;
          const state = isDamaged ? "REVIEW" : "OK";

          await tx.vehicleInventoryItem.upsert({
            where: { id: inventoryItemId },
            update: {},
            create: {
              id: inventoryItemId,
              compartmentId,
              name: toolName,
              expectedQuantity: 1,
              state,
              notes: isDamaged ? "Cinta de sujecion deteriorada; no utilizar" : null,
            },
          });

          await tx.inspectionItem.upsert({
            where: { id: id(`checked_${vehicleData.index}_${itemIndex}`) },
            update: {},
            create: {
              id: id(`checked_${vehicleData.index}_${itemIndex}`),
              inspectionId,
              inventoryItemId,
              expectedQuantity: 1,
              observedQuantity: 1,
              result: isDamaged ? "DAMAGED" : "OK",
              observations: isDamaged ? "Elemento retirado para revision y recambio" : null,
            },
          });
        }

        for (const name of ["oficial", "bombero"]) {
          await tx.inspectionResponsible.upsert({
            where: { inspectionId_userId: { inspectionId, userId: id(name) } },
            update: {},
            create: { inspectionId, userId: id(name) },
          });
        }

        // Si está en mantenimiento, crear trabajo de taller
        if (vehicleData.status === "MAINTENANCE") {
          await tx.maintenanceJob.upsert({
            where: { id: id(`maintenance_${vehicleData.index}`) },
            update: {},
            create: {
              id: id(`maintenance_${vehicleData.index}`),
              assetId,
              title: `Service integral y frenos - ${vehicleData.name}`,
              description: "Recambio de cintas de freno traseras y purga de circuito hidráulico.",
              blocksOperation: true,
              status: "IN_PROGRESS",
              dueAt: day(3),
              responsibleUserId: id("operador"),
              createdByUserId: id("admin"),
            },
          });
          await tx.workTask.upsert({ where: { id: id(`maintenance_task_${vehicleData.index}`) }, update: {}, create: { id: id(`maintenance_task_${vehicleData.index}`), title: `Mantenimiento: ${vehicleData.name}`.slice(0, 160), description: "Trabajo ficticio publicado para tomar y realizar por el personal. Requiere verificacion del mando.", maintenanceJobId: id(`maintenance_${vehicleData.index}`), createdByUserId: id("operador"), dueOn: day(3) } });
        }
      }

      // -----------------------------------------------------------------------
      // 6. Alertas e Incidentes Operativos Reales
      // -----------------------------------------------------------------------
      // Alerta 1: Incendio Forestal (Activa, Alta Prioridad)
      const alert0Id = id("alert_0");
      await tx.alert.upsert({
        where: { id: alert0Id },
        update: {},
        create: {
          id: alert0Id,
          type: "FIRE",
          priority: "HIGH",
          description: "[DEMO] Simulacro de incendio de pastizal. Registro ficticio; no despachar recursos.",
          location: "Ruta Nacional 8 Km 615, margen norte",
          contactPhone: "0000000000",
          status: "ACTIVE",
          createdByUserId: id("operador"),
        },
      });

      // Respuestas de la dotación
      await tx.alertResponse.upsert({
        where: { alertId_userId: { alertId: alert0Id, userId: id("oficial") } },
        update: {},
        create: { alertId: alert0Id, userId: id("oficial"), response: "GOING" },
      });
      await tx.alertResponse.upsert({
        where: { alertId_userId: { alertId: alert0Id, userId: id("bombero") } },
        update: {},
        create: { alertId: alert0Id, userId: id("bombero"), response: "GOING" },
      });
      await tx.alertResponse.upsert({
        where: { alertId_userId: { alertId: alert0Id, userId: id("sofia") } },
        update: {},
        create: { alertId: alert0Id, userId: id("sofia"), response: "GOING" },
      });

      // Incidente 0 abierto a partir de la alerta 1
      const incident0Id = id("incident_0");
      await tx.incident.upsert({
        where: { id: incident0Id },
        update: {},
        create: {
          id: incident0Id,
          alertId: alert0Id,
          title: "Incendio Forestal Ruta 8 Km 615",
          type: "FIRE",
          description: "Dotaciones de Móvil 14 y Móvil 4 combatiendo flanco izquierdo para evitar cruce de alambrado.",
          location: "Ruta Nacional 8 Km 615",
          status: "OPEN",
          occurredAt: new Date(Date.now() - 30 * 60000),
          createdByUserId: id("operador"),
        },
      });

      await tx.incidentAssignment.upsert({
        where: { incidentId_userId: { incidentId: incident0Id, userId: id("oficial") } },
        update: {},
        create: { incidentId: incident0Id, userId: id("oficial") },
      });

      await tx.incidentVehicle.upsert({
        where: { incidentId_assetId: { incidentId: incident0Id, assetId: id("asset_0") } },
        update: {},
        create: { incidentId: incident0Id, assetId: id("asset_0") },
      });

      await tx.incidentUpdate.upsert({
        where: { id: id("incident_update_0") },
        update: {},
        create: {
          id: id("incident_update_0"),
          incidentId: incident0Id,
          authorUserId: id("oficial"),
          body: "Móvil 14 y Móvil 4 en el lugar. Ataque directo con línea de 45mm y mochilas de agua. Perímetro contenido en un 60%.",
        },
      });

      // Libreta de siniestro
      await tx.incidentNotebookEntry.upsert({
        where: { id: id("notebook_0") },
        update: {},
        create: {
          id: id("notebook_0"),
          incidentId: incident0Id,
          category: "NOTE",
          title: "Llegada al siniestro",
          body: "Se arriba a las 14:15 hs. Se emplaza Móvil 14 sobre calle vecinal. Se solicita apoyo de cisterna comunal.",
          occurredAt: new Date(Date.now() - 25 * 60000),
          authorUserId: id("oficial"),
        },
      });

      // Alerta 2: Accidente Vial (Resuelta / Cerrada de ayer)
      const alert1Id = id("alert_1");
      await tx.alert.upsert({
        where: { id: alert1Id },
        update: {},
        create: {
          id: alert1Id,
          type: "ACCIDENT",
          priority: "HIGH",
          description: "Colisión frontal entre utilitario y camión con un atrapado consciente.",
          location: "Ruta 8 y acceso a Suco",
          status: "RESOLVED",
          createdByUserId: id("admin"),
          resolvedByUserId: id("admin"),
          resolvedAt: day(-1),
        },
      });

      const incident1Id = id("incident_1");
      await tx.incident.upsert({
        where: { id: incident1Id },
        update: {},
        create: {
          id: incident1Id,
          alertId: alert1Id,
          title: "[DEMO] Colision vehicular simulada",
          type: "ACCIDENT",
          description: "Rescate y extricación de conductor atrapado con equipo hidráulico Holmatro. Derivado al Hospital de Sampacho.",
          location: "Ruta 8 y acceso a Suco",
          status: "CLOSED",
          occurredAt: day(-1),
          createdByUserId: id("admin"),
          closedByUserId: id("oficial"),
          closedAt: new Date(day(-1).getTime() + 2 * 3600000),
          closingReport: "Paciente liberado y trasladado estable por ambulancia del Hospital Municipal. Calzada despejada por Policía Caminera.",
        },
      });

      await tx.incidentAssignment.upsert({
        where: { incidentId_userId: { incidentId: incident1Id, userId: id("oficial") } },
        update: {},
        create: { incidentId: incident1Id, userId: id("oficial") },
      });

      await tx.incidentVehicle.upsert({
        where: { incidentId_assetId: { incidentId: incident1Id, assetId: id("asset_1") } },
        update: {},
        create: { incidentId: incident1Id, assetId: id("asset_1") },
      });

      // -----------------------------------------------------------------------
      // 7. Equipos de Protección Personal (EPP / Vestimenta)
      // -----------------------------------------------------------------------
      const ppeCategories = ["HELMET", "COAT", "GLOVES"] as const;
      for (const [index, category] of ppeCategories.entries()) {
        const assetId = id(`ppe_asset_${index}`);
        const equipmentId = id(`ppe_${index}`);

        await tx.asset.upsert({
          where: { id: assetId },
          update: {},
          create: {
            id: assetId,
            name: `Traje Estructural EPP ${category} Rosenbauer`,
            assetType: "PPE",
            status: "OPERATIONAL",
            lastCheckDate: day(0),
          },
        });

        await tx.personalEquipment.upsert({
          where: { id: equipmentId },
          update: {},
          create: {
            id: equipmentId,
            assetId,
            code: `BVS-EPP-${index + 101}`,
            category,
            size: "L",
          },
        });

        await tx.personalEquipmentCheck.upsert({
          where: { id: id(`ppe_check_${index}`) },
          update: {},
          create: {
            id: id(`ppe_check_${index}`),
            equipmentId,
            checkedByUserId: id("oficial"),
            condition: "OK",
            notes: "Inspección de barrera térmica y reflectivos aprobada.",
            checkedAt: day(0),
          },
        });

        if (index === 0) {
          await tx.personalEquipmentIssue.upsert({
            where: { id: id("ppe_issue") },
            update: {},
            create: {
              id: id("ppe_issue"),
              equipmentId,
              userId: id("bombero"),
              issuedByUserId: id("operador"),
              issueNotes: "Asignación de equipo de protección personal para dotación activa.",
            },
          });
        }
      }

      // Solicitud de renovación de vestimenta
      await tx.personalEquipmentRequest.upsert({
        where: { id: id("clothing_request_0") },
        update: {},
        create: {
          id: id("clothing_request_0"),
          userId: id("bombero"),
          category: "GLOVES",
          size: "L",
          reason: "Desgaste natural de cuero en guantes de combate estructural post-incendio.",
          status: "APPROVED",
          reviewedByUserId: id("operador"),
          createdAt: day(-2),
          reviewedAt: day(-1),
          reviewNotes: "Aprobado para recambio con stock de intendencia.",
        },
      });

      // -----------------------------------------------------------------------
      // 8. Compresor y Equipos ERA (Respiración Autónoma)
      // -----------------------------------------------------------------------
      const fillStart = new Date(day(-1).getTime() + 10 * 3600000);
      const fillEnd = new Date(fillStart.getTime() + 15 * 60000);

      const compAssetId = id("air_comp_asset_0");
      await tx.asset.upsert({
        where: { id: compAssetId },
        update: {},
        create: {
          id: compAssetId,
          name: "Compresor de Aire Respirable Bauer PE-250",
          assetType: "OTHER",
          status: "OPERATIONAL",
        },
      });

      await tx.airCompressor.upsert({
        where: { id: id("air_comp_0") },
        update: {},
        create: {
          id: id("air_comp_0"),
          assetId: compAssetId,
          code: "COMP-BAUER-01",
          maxPressureBar: 300,
          totalRunMinutes: 140,
          filterBaselineMinutes: 0,
          filterLifeMinutes: 300,
          filterReference: "BAUER-TRIPLEX-P21",
          filterInstalledAt: day(-45),
          airQualityReference: "CERT-CALIDAD-IRAM-2026",
          airQualityValidUntil: day(180),
          reviewedAt: day(-2),
          lastRunEndedAt: fillEnd,
        },
      });

      // Cilindros ERA de composite
      for (let index = 0; index < 3; index++) {
        const cylinderAssetId = id(`air_tube_asset_${index}`);
        const cylinderId = id(`air_tube_${index}`);

        await tx.asset.upsert({
          where: { id: cylinderAssetId },
          update: {},
          create: {
            id: cylinderAssetId,
            name: `Cilindro ERA Composite 6.8L #${index + 1}`,
            assetType: "PPE",
            status: "OPERATIONAL",
          },
        });

        await tx.airCylinder.upsert({
          where: { id: cylinderId },
          update: {},
          create: {
            id: cylinderId,
            assetId: cylinderAssetId,
            code: `ERA-300-${index + 1}`,
            serialNumber: `SN-DRAGER-202${index}`,
            ratedPressureBar: 300,
            pressureBar: 290,
            vehicleAssetId: id("asset_0"),
            reviewedAt: day(-2),
            lastEventAt: fillEnd,
            createdAt: day(-60),
          },
        });

        await tx.airHydroTest.upsert({
          where: { id: id(`air_hydro_${index}`) },
          update: {},
          create: {
            id: id(`air_hydro_${index}`),
            cylinderId,
            result: "PASS",
            testedOn: day(-60),
            validUntil: day(1000),
            certificateReference: `PH-IRAM-3520-BVS-${index + 1}`,
            notes: "Certificado sintetico para demostrar el registro; no indica un intervalo real de certificacion ni acredita una prueba fisica.",
            registeredByUserId: id("operador"),
            createdAt: day(-59),
          },
        });
      }

      // Registro de carga de tubos
      await tx.airFill.upsert({
        where: { id: id("air_fill") },
        update: {},
        create: {
          id: id("air_fill"),
          operationKey: "123e4567-e89b-42d3-a456-426614174000",
          requestHash: createHash("sha256").update("demo-air-fill").digest("hex"),
          compressorId: id("air_comp_0"),
          startedAt: fillStart,
          endedAt: fillEnd,
          runMinutes: 15,
          operatorUserId: id("oficial"),
          createdByUserId: id("operador"),
          reason: "TRAINING",
          notes: "Carga de tubos post-práctica de rescate en estructuras colapsadas.",
          compressorSnapshot: {
            code: "COMP-BAUER-01",
            name: "Compresor Bauer PE-250",
            maxPressureBar: 300,
            totalMinutesBefore: 125,
            filterBaselineMinutes: 0,
            filterLifeMinutes: 300,
            filterReference: "BAUER-TRIPLEX-P21",
            airQualityReference: "CERT-CALIDAD-IRAM-2026",
            airQualityValidUntil: day(180).toISOString(),
          },
        },
      });

      await tx.airFillItem.upsert({
        where: { id: id("air_fill_item") },
        update: {},
        create: {
          id: id("air_fill_item"),
          fillId: id("air_fill"),
          cylinderId: id("air_tube_0"),
          pressureBar: 290,
          previousPressureBar: 50,
          cylinderSnapshot: {
            code: "ERA-300-1",
            serialNumber: "SN-DRAGER-2020",
            ratedPressureBar: 300,
            vehicleAssetId: id("asset_0"),
            hydroCertificate: "PH-IRAM-3520-BVS-1",
            hydroValidUntil: day(1000).toISOString(),
          },
        },
      });

      // -----------------------------------------------------------------------
      // 9. Viajes de Agua y Cargas de Combustible
      // -----------------------------------------------------------------------
      await tx.waterTrip.upsert({
        where: { id: id("water_trip_0") },
        update: {},
        create: {
          id: id("water_trip_0"),
          operationKey: "223e4567-e89b-42d3-a456-426614174001",
          requestHash: createHash("sha256").update("demo-water-trip-0").digest("hex"),
          assetId: id("asset_2"), // Cisterna Móvil 21
          customer: "Estancia Los Ombúes - Familia Cacciavillani",
          destination: "Ruta 8 Km 618 camino vecinal",
          departedAt: day(-1),
          returnedAt: new Date(day(-1).getTime() + 2 * 3600000),
          startOdometer: 64080,
          endOdometer: 64100,
          tripCount: 1,
          chargeCents: 4500000, // $45.000
          clientPaidAt: day(-1),
          leaderUserId: id("bombero"),
          createdByUserId: id("admin"),
          notes: "Abastecimiento de 15.000 L de agua para consumo ganadero por rotura de molino.",
        },
      });

      await tx.fuelRecord.upsert({
        where: { id: id("fuel_record_0") },
        update: {},
        create: {
          id: id("fuel_record_0"),
          operationKey: "323e4567-e89b-42d3-a456-426614174002",
          requestHash: createHash("sha256").update("demo-fuel-0").digest("hex"),
          assetId: id("asset_0"), // Móvil 14
          occurredAt: day(-2),
          volumeMilliliters: 120000, // 120 Litros
          costCents: 15600000, // $156.000
          odometer: 42380,
          reason: "EMERGENCY",
          notes: "Carga en YPF Sampacho con orden de compra municipal N° 849.",
          createdByUserId: id("operador"),
        },
      });

      // -----------------------------------------------------------------------
      // 10. Tareas de Mantenimiento de Cuartel (WorkTasks)
      // -----------------------------------------------------------------------
      const workTask0 = id("work_task_0");
      await tx.workTask.upsert({
        where: { id: workTask0 },
        update: {},
        create: {
          id: workTask0,
          title: "Zafarrancho y Limpieza de Sala de Máquinas",
          description: "Lavado a presión de pisos de la sala de guardia, revisión de tomas eléctricas y orden de pañol de mangas.",
          dueOn: day(2),
          status: "ASSIGNED",
          createdByUserId: id("admin"),
        },
      });

      await tx.workTaskMember.upsert({
        where: { taskId_userId: { taskId: workTask0, userId: id("aspirante") } },
        update: {},
        create: { taskId: workTask0, userId: id("aspirante") },
      });

      // -----------------------------------------------------------------------
      // 11. Protocolos Operativos y Documentos
      // -----------------------------------------------------------------------
      const shiftDoc = await tx.shift.findUniqueOrThrow({
        where: { id: pastShiftId },
        include: { assignments: { include: { user: { select: PUBLIC_USER_SELECT } } } },
      });

      const incidentDoc = await tx.incident.findUniqueOrThrow({
        where: { id: incident1Id },
        include: {
          assignments: { include: { user: { select: PUBLIC_USER_SELECT } } },
          vehicles: { include: { asset: { select: { id: true, name: true } } } },
        },
      });

      await tx.operationalDocument.upsert({
        where: { id: id("doc_protocol_0") },
        update: {},
        create: {
          id: id("doc_protocol_0"),
          kind: "PROTOCOL",
          status: "PUBLISHED",
          title: "[DEMO] Documento de entrenamiento de rescate",
          category: "Rescate Técnico",
          body: "Documento exclusivamente ficticio para practicar publicacion y consulta. No contiene instrucciones operativas aprobadas y no debe utilizarse como protocolo de respuesta real.",
          createdAt: day(-31),
          publishedAt: day(-30),
          createdByUserId: id("admin"),
        },
      });

      await tx.operationalDocument.upsert({
        where: { id: id("SHIFT_REPORT") },
        update: {},
        create: {
          id: id("SHIFT_REPORT"),
          kind: "SHIFT_REPORT",
          status: "DRAFT",
          title: "Acta de Cierre de Guardia Diurna",
          category: "Guardias",
          body: "Guardia cubierta con normalidad sin novedades de trascendencia. Parque automotor revisado.",
          createdByUserId: id("guardia"),
          createdAt: new Date(day(-1).getTime() + 23 * 3600000),
          shiftId: shiftDoc.id,
        },
      });

      await tx.operationalDocument.upsert({
        where: { id: id("INCIDENT_REPORT") },
        update: {},
        create: {
          id: id("INCIDENT_REPORT"),
          kind: "INCIDENT_REPORT",
          status: "PUBLISHED",
          title: "Informe Técnico de Intervención: Acceso Suco",
          category: "Incidentes",
          body: "Detalle técnico de la colisión vial. Se utilizó equipo hidráulico de corte sobre parante B.",
          createdByUserId: id("admin"),
          createdAt: new Date(day(-1).getTime() + 2 * 3600000),
          publishedAt: new Date(day(-1).getTime() + 3 * 3600000),
          incidentId: incidentDoc.id,
          publicationContext: JSON.parse(
            JSON.stringify({ incident: incidentDoc, publishedByUserId: id("admin") })
          ),
        },
      });

      // -----------------------------------------------------------------------
      // 12. Directorio Telefónico y Radio (Contactos Operativos)
      // -----------------------------------------------------------------------
      const contacts = [
        {
          name: "Policía Distrito Sampacho (Comisaría)",
          category: "Seguridad y Fuerzas",
          phone: "03582-420222",
          radio: "VHF 148.800 MHz (Subtono 103.5)",
          isEmergency: true,
        },
        {
          name: "Hospital Municipal Dr. Juan B. Medeot",
          category: "Salud y Emergencias",
          phone: "03582-420333",
          radio: "Canal Emergencias Médicas 107",
          isEmergency: true,
        },
        {
          name: "Bomberos Voluntarios Coronel Moldes (Regional 3)",
          category: "Cuarteles Vecinos",
          phone: "03582-481300",
          radio: "VHF 149.250 MHz",
          isEmergency: false,
        },
        {
          name: "Defensa Civil Municipalidad de Sampacho",
          category: "Gobierno Local",
          phone: "03582-420100",
          radio: "VHF 148.550 MHz",
          isEmergency: false,
        },
      ];

      for (const [idx, c] of contacts.entries()) {
        await tx.operationalContact.upsert({
          where: { id: id(`contact_${idx}`) },
          update: {},
          create: {
            id: id(`contact_${idx}`),
            name: `[DEMO] ${c.name}`,
            category: c.category,
            phone: "0000000000",
            radioFrequency: `DEMO-CANAL-${idx + 1}`,
            isEmergency: c.isEmergency,
            notes: "Contacto ficticio; no llamar ni utilizar como frecuencia real.",
            createdByUserId: id("admin"),
          },
        });
      }

      // -----------------------------------------------------------------------
      // 13. Vencimientos y Certificaciones (Compliance)
      // -----------------------------------------------------------------------
      const compliance = [
        {
          subjectType: "ASSET" as const,
          category: "VTV" as const,
          assetId: id("asset_0"), // Móvil 14
          userId: null,
          title: "VTV Nacional Móvil 14 (Atego)",
          expiresAt: day(240),
          warningDays: 30,
        },
        {
          subjectType: "ASSET" as const,
          category: "VTV" as const,
          assetId: id("asset_1"), // Móvil 8
          userId: null,
          title: "VTV Nacional Móvil 8 (Rescate)",
          expiresAt: day(12), // Próximo a vencer
          warningDays: 30,
        },
        {
          subjectType: "ASSET" as const,
          category: "INSURANCE" as const,
          assetId: id("asset_0"),
          userId: null,
          title: "Póliza Flota La Segunda Seguros",
          expiresAt: day(180),
          warningDays: 30,
        },
        {
          subjectType: "USER" as const,
          category: "DRIVER_LICENSE" as const,
          assetId: null,
          userId: id("bombero"),
          title: "Licencia de Conducir Clase D (Vehículos de Emergencia)",
          expiresAt: day(300),
          warningDays: 30,
        },
      ];

      for (const [idx, comp] of compliance.entries()) {
        await tx.complianceRecord.upsert({
          where: { id: id(`compliance_${idx}`) },
          update: {},
          create: {
            id: id(`compliance_${idx}`),
            subjectType: comp.subjectType,
            category: comp.category,
            assetId: comp.assetId,
            userId: comp.userId,
            title: comp.title,
            issuedAt: day(-365),
            expiresAt: comp.expiresAt,
            warningDays: comp.warningDays,
            issuer: "Organismo de Control",
            createdByUserId: id("admin"),
          },
        });
      }

      // -----------------------------------------------------------------------
      // 14. Chat de Comunicaciones del Cuartel
      // -----------------------------------------------------------------------
      const messages = [
        {
          author: "admin",
          body: "📌 ATENCIÓN DOTACIÓN: Reunión general de cuerpo activo este viernes 20:30 hs. Trataremos el plan de contingencia de incendios forestales de verano.",
          isPinned: true,
        },
        {
          author: "operador",
          body: "Móvil 14 y Móvil 4 confirmaron arribo al incendio de Campo La Escondida. Se mantiene escucha activa en repetidora VHF.",
          isPinned: false,
        },
        {
          author: "bombero",
          body: "Cisterna Móvil 21 completó carga en hidrante de Plaza San Martín y se encuentra listo en apresto.",
          isPinned: false,
        },
      ];

      for (const [idx, msg] of messages.entries()) {
        await tx.chatMessage.upsert({
          where: { id: id(`message_${idx}`) },
          update: {},
          create: {
            id: id(`message_${idx}`),
            authorUserId: id(msg.author),
            body: `[DEMO] ${msg.body}`,
            isPinned: msg.isPinned,
          },
        });
      }

      const extended = await seedExtendedScenarios(tx, passwordHash, reference);
      await seedCurrentRules(tx, passwordHash, reference);
      const questionnaire = await seedQuestionnaireScenarios(tx);
      await seedProfessionalScenarios(tx, reference);
      await seedCompleteIncidentSheets(tx, reference);
      if (options.resetPasswords) await resetDemoCredentials(tx, password);

      // Auditoría final
      await tx.auditLog.upsert({
        where: { id: id("seed_audit") },
        update: {},
        create: {
          id: id("seed_audit"),
          actorUserId: id("admin"),
          action: "DEMO_COMPREHENSIVE_SEEDED",
          entityType: "System",
          entityId: "bomberos_sampacho",
          metadata: {
            organization: "Bomberos Voluntarios Sampacho",
            rosterCount: roster.length,
            fleetCount: fleet.length,
            timestamp: new Date().toISOString(),
          },
        },
      });

      return {
        users: await tx.user.count(), vehicles: await tx.vehicle.count(), stations: await tx.station.count(),
        shifts: await tx.shift.count(), participations: await tx.serviceParticipation.count(),
        alerts: await tx.alert.count(), incidents: await tx.incident.count(),
        cylinders: await tx.airCylinder.count(), compressors: await tx.airCompressor.count(),
        waterTrips: await tx.waterTrip.count(), fuelRecords: await tx.fuelRecord.count(),
        inventoryItems: await tx.vehicleInventoryItem.count(), inspections: await tx.inspection.count(),
        tasks: await tx.workTask.count(), garments: await tx.personalEquipment.count(),
        declarations: await tx.personalDeclaration.count(), messages: await tx.chatMessage.count(),
        notices: await tx.dispatchNotice.count(), driverAuthorizations: await tx.vehicleDriverAuthorization.count(),
        expenseClaims: await tx.expenseClaim.count(), expenseApprovals: await tx.expenseApproval.count(),
        expensePayments: await tx.expensePayment.count(), courses: await tx.courseAttendance.count(),
        taskTransfers: await tx.workTaskTransfer.count(), shiftSwaps: await tx.shiftSwapRequest.count(),
        receipts: await tx.expenseClaim.count({ where: { receiptSha256: { not: null } } }),
        attendanceCorrections: await tx.attendanceCorrection.count(),
        interventionSheets: await tx.incidentSheet.count(),
        extended, questionnaire,
      };
    },
    // Neon adds network latency to every statement. Keep the seed atomic, but
    // allow enough time for the complete synthetic dataset to reach a remote DB.
    { isolationLevel: "Serializable", maxWait: 30000, timeout: 600000 }
  );
}
