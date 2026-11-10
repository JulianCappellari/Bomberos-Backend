-- Reglas del cuestionario maestro 2026-11-10 (E08, E10, K02, K07, M02)
ALTER TABLE "Attendance" ADD COLUMN "discardedAt" TIMESTAMP(3), ADD COLUMN "discardReason" VARCHAR(200);
-- E08/L05: las permanencias ya cerradas por vencimiento dejan de acreditar tiempo.
UPDATE "Attendance" SET "discardedAt" = "checkOutAt", "discardReason" = 'Cierre automatico sin revalidacion', "workedMinutes" = 0
WHERE "status" = 'CLOSED' AND "checkOutTrust" IS NULL AND "promptShownAt" IS NOT NULL AND "checkOutAt" IS NOT NULL;

-- B10/B11: permisos especiales independientes, vigentes hasta su revocacion.
ALTER TABLE "User" ADD COLUMN "specialPermissions" TEXT[] DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "WorkTask" ADD COLUMN "requiresPresence" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "AttendanceCorrection" (
  "id" TEXT NOT NULL,
  "attendanceId" TEXT NOT NULL,
  "action" VARCHAR(16) NOT NULL,
  "effectiveAt" TIMESTAMP(3) NOT NULL,
  "reason" VARCHAR(2000) NOT NULL,
  "status" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
  "requestedByUserId" TEXT NOT NULL,
  "decidedByUserId" TEXT,
  "decisionNote" VARCHAR(1000),
  "decidedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AttendanceCorrection_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AttendanceCorrection_status_createdAt_idx" ON "AttendanceCorrection"("status", "createdAt");
CREATE INDEX "AttendanceCorrection_attendanceId_idx" ON "AttendanceCorrection"("attendanceId");
ALTER TABLE "AttendanceCorrection" ADD CONSTRAINT "AttendanceCorrection_attendanceId_fkey" FOREIGN KEY ("attendanceId") REFERENCES "Attendance"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AttendanceCorrection" ADD CONSTRAINT "AttendanceCorrection_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AttendanceCorrection" ADD CONSTRAINT "AttendanceCorrection_decidedByUserId_fkey" FOREIGN KEY ("decidedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "WorkTaskTransfer" (
  "id" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "fromUserId" TEXT NOT NULL,
  "toUserId" TEXT NOT NULL,
  "notes" VARCHAR(1000) NOT NULL,
  "status" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMP(3),
  CONSTRAINT "WorkTaskTransfer_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "WorkTaskTransfer_toUserId_status_idx" ON "WorkTaskTransfer"("toUserId", "status");
CREATE INDEX "WorkTaskTransfer_taskId_status_idx" ON "WorkTaskTransfer"("taskId", "status");
ALTER TABLE "WorkTaskTransfer" ADD CONSTRAINT "WorkTaskTransfer_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "WorkTask"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WorkTaskTransfer" ADD CONSTRAINT "WorkTaskTransfer_fromUserId_fkey" FOREIGN KEY ("fromUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WorkTaskTransfer" ADD CONSTRAINT "WorkTaskTransfer_toUserId_fkey" FOREIGN KEY ("toUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "ShiftSwapRequest" (
  "id" TEXT NOT NULL,
  "shiftId" TEXT NOT NULL,
  "fromUserId" TEXT NOT NULL,
  "toUserId" TEXT NOT NULL,
  "reason" VARCHAR(1000) NOT NULL,
  "status" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
  "acceptedAt" TIMESTAMP(3),
  "decidedByUserId" TEXT,
  "decisionNote" VARCHAR(1000),
  "decidedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ShiftSwapRequest_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ShiftSwapRequest_shiftId_status_idx" ON "ShiftSwapRequest"("shiftId", "status");
CREATE INDEX "ShiftSwapRequest_toUserId_status_idx" ON "ShiftSwapRequest"("toUserId", "status");
ALTER TABLE "ShiftSwapRequest" ADD CONSTRAINT "ShiftSwapRequest_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ShiftSwapRequest" ADD CONSTRAINT "ShiftSwapRequest_fromUserId_fkey" FOREIGN KEY ("fromUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ShiftSwapRequest" ADD CONSTRAINT "ShiftSwapRequest_toUserId_fkey" FOREIGN KEY ("toUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ShiftSwapRequest" ADD CONSTRAINT "ShiftSwapRequest_decidedByUserId_fkey" FOREIGN KEY ("decidedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- G12: el retorno sin llegada no exige motivo (cadena vacia admitida; NULL solo cuando hubo llegada).
ALTER TABLE "MissionMovement" DROP CONSTRAINT "MissionMovement_return_chronology";
ALTER TABLE "MissionMovement" ADD CONSTRAINT "MissionMovement_return_chronology" CHECK (
 ("returnedAt" IS NULL AND "returnWithoutArrivalReason" IS NULL) OR
 ("returnedAt" IS NOT NULL AND "returnedAt" >= "departedAt" AND (
    ("arrivedAt" IS NOT NULL AND "returnedAt" >= "arrivedAt" AND "returnWithoutArrivalReason" IS NULL) OR
    ("arrivedAt" IS NULL AND "returnWithoutArrivalReason" IS NOT NULL)
 ))
);

-- G18: categorias de anexos posteriores al cierre.
DO $$
DECLARE category_check TEXT;
BEGIN
 SELECT conname INTO STRICT category_check FROM pg_constraint
 WHERE conrelid = '"IncidentNotebookEntry"'::regclass AND contype='c'
 AND pg_get_constraintdef(oid) LIKE '%category%';
 EXECUTE format('ALTER TABLE "IncidentNotebookEntry" DROP CONSTRAINT %I', category_check);
END $$;
ALTER TABLE "IncidentNotebookEntry" ADD CONSTRAINT "IncidentNotebookEntry_category_valid" CHECK ("category" IN ('PLACE', 'PERSON', 'VEHICLE', 'AGENCY', 'NOTE', 'NOVELTY', 'THIRD_PARTY', 'CORRECTION', 'DAMAGE'));
