CREATE TYPE "AlertAttendanceOutcome" AS ENUM ('NO_SHOW');

ALTER TABLE "AlertResponse"
ADD COLUMN "attendanceOutcome" "AlertAttendanceOutcome",
ADD COLUMN "attendanceOutcomeAt" TIMESTAMP(3);
