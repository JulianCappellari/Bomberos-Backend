-- Additive migration. Existing operational records and indexes are preserved.
CREATE TYPE "WorkTaskStatus" AS ENUM ('ASSIGNED', 'SUBMITTED', 'RETURNED', 'VERIFIED', 'CANCELLED');
CREATE TABLE "WorkTask" (
  "id" TEXT PRIMARY KEY, "title" VARCHAR(160) NOT NULL, "description" VARCHAR(4000) NOT NULL,
  "dueOn" DATE, "status" "WorkTaskStatus" NOT NULL DEFAULT 'ASSIGNED', "isSelfReported" BOOLEAN NOT NULL DEFAULT false,
  "completionNotes" VARCHAR(4000), "evidenceUrls" JSONB, "completedAt" TIMESTAMP(3),
  "reviewedByUserId" TEXT REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "reviewedAt" TIMESTAMP(3), "reviewNotes" VARCHAR(2000),
  "createdByUserId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" > 0),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WorkTask_completion_valid" CHECK ("status" NOT IN ('SUBMITTED', 'VERIFIED', 'RETURNED') OR ("completedAt" IS NOT NULL AND "completionNotes" IS NOT NULL)),
  CONSTRAINT "WorkTask_review_valid" CHECK ("status" NOT IN ('VERIFIED', 'RETURNED', 'CANCELLED') OR ("reviewedAt" IS NOT NULL AND "reviewedByUserId" IS NOT NULL AND "reviewNotes" IS NOT NULL))
);
CREATE TABLE "WorkTaskMember" (
  "taskId" TEXT NOT NULL REFERENCES "WorkTask"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "declinedAt" TIMESTAMP(3), PRIMARY KEY ("taskId", "userId")
);
CREATE TABLE "WorkTaskEvent" (
  "id" TEXT PRIMARY KEY, "taskId" TEXT NOT NULL REFERENCES "WorkTask"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "actorUserId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "action" VARCHAR(40) NOT NULL, "notes" VARCHAR(4000) NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "IncidentNotebookEntry" (
  "id" TEXT PRIMARY KEY, "incidentId" TEXT NOT NULL REFERENCES "Incident"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "category" VARCHAR(20) NOT NULL CHECK ("category" IN ('PLACE', 'PERSON', 'VEHICLE', 'AGENCY', 'NOTE')),
  "title" VARCHAR(160) NOT NULL, "body" VARCHAR(4000) NOT NULL, "occurredAt" TIMESTAMP(3) NOT NULL,
  "authorUserId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" > 0), "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "FuelRecord" (
  "id" TEXT PRIMARY KEY, "operationKey" VARCHAR(36) NOT NULL, "requestHash" VARCHAR(64) NOT NULL,
  "assetId" TEXT NOT NULL REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "occurredAt" TIMESTAMP(3) NOT NULL, "volumeMilliliters" INTEGER NOT NULL CHECK ("volumeMilliliters" > 0 AND "volumeMilliliters" <= 10000000),
  "costCents" INTEGER CHECK ("costCents" >= 0 AND "costCents" <= 1000000000), "odometer" INTEGER CHECK ("odometer" >= 0 AND "odometer" <= 10000000),
  "reason" VARCHAR(40) NOT NULL CHECK ("reason" IN ('EMERGENCY', 'TRAINING', 'SERVICE', 'WATER', 'OTHER')), "notes" VARCHAR(2000) NOT NULL,
  "createdByUserId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "voidedAt" TIMESTAMP(3), "voidReason" VARCHAR(2000), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FuelRecord_void_valid" CHECK (("voidedAt" IS NULL) = ("voidReason" IS NULL))
);
CREATE TABLE "WaterTrip" (
  "id" TEXT PRIMARY KEY, "operationKey" VARCHAR(36) NOT NULL, "requestHash" VARCHAR(64) NOT NULL,
  "assetId" TEXT NOT NULL REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "customer" VARCHAR(160) NOT NULL, "destination" VARCHAR(200) NOT NULL,
  "departedAt" TIMESTAMP(3) NOT NULL, "returnedAt" TIMESTAMP(3) NOT NULL,
  "startOdometer" INTEGER NOT NULL, "endOdometer" INTEGER NOT NULL,
  "tripCount" INTEGER NOT NULL CHECK ("tripCount" > 0 AND "tripCount" <= 100),
  "chargeCents" INTEGER NOT NULL CHECK ("chargeCents" >= 0 AND "chargeCents" <= 1000000000), "clientPaidAt" TIMESTAMP(3),
  "leaderUserId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "createdByUserId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "notes" VARCHAR(2000) NOT NULL, "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" > 0),
  "voidedAt" TIMESTAMP(3), "voidReason" VARCHAR(2000), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WaterTrip_chronology" CHECK ("returnedAt" > "departedAt" AND "startOdometer" >= 0 AND "endOdometer" >= "startOdometer" AND "endOdometer" <= 10000000),
  CONSTRAINT "WaterTrip_void_valid" CHECK (("voidedAt" IS NULL) = ("voidReason" IS NULL) AND ("voidedAt" IS NULL OR "clientPaidAt" IS NULL))
);
CREATE TABLE "WaterTripMember" (
  "tripId" TEXT NOT NULL REFERENCES "WaterTrip"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "compensationCents" INTEGER NOT NULL CHECK ("compensationCents" >= 0 AND "compensationCents" <= 1000000000),
  "paidAt" TIMESTAMP(3), PRIMARY KEY ("tripId", "userId")
);
CREATE INDEX "WorkTask_status_dueOn_idx" ON "WorkTask"("status", "dueOn");
CREATE INDEX "WorkTaskMember_userId_idx" ON "WorkTaskMember"("userId");
CREATE INDEX "WorkTaskEvent_taskId_createdAt_idx" ON "WorkTaskEvent"("taskId", "createdAt");
CREATE INDEX "IncidentNotebookEntry_incidentId_deletedAt_occurredAt_idx" ON "IncidentNotebookEntry"("incidentId", "deletedAt", "occurredAt");
CREATE UNIQUE INDEX "FuelRecord_operationKey_key" ON "FuelRecord"("operationKey");
CREATE INDEX "FuelRecord_assetId_occurredAt_idx" ON "FuelRecord"("assetId", "occurredAt");
CREATE UNIQUE INDEX "WaterTrip_operationKey_key" ON "WaterTrip"("operationKey");
CREATE INDEX "WaterTrip_assetId_departedAt_idx" ON "WaterTrip"("assetId", "departedAt");
CREATE INDEX "WaterTripMember_userId_idx" ON "WaterTripMember"("userId");
