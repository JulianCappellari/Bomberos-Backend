CREATE TYPE "AvailabilityStatus" AS ENUM ('AVAILABLE', 'ON_CALL', 'UNAVAILABLE');
CREATE TYPE "MaintenanceStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CANCELLED');
CREATE TYPE "DocumentKind" AS ENUM ('PROTOCOL', 'SHIFT_REPORT', 'INCIDENT_REPORT');
CREATE TYPE "DocumentStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

CREATE TABLE "PersonnelAvailability" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "date" DATE NOT NULL,
  "period" "ShiftPeriod" NOT NULL,
  "status" "AvailabilityStatus" NOT NULL,
  "notes" VARCHAR(1000),
  "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" > 0),
  "editedByUserId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "PersonnelAvailability_userId_date_period_key" ON "PersonnelAvailability"("userId", "date", "period");
CREATE INDEX "PersonnelAvailability_date_period_status_idx" ON "PersonnelAvailability"("date", "period", "status");

CREATE TABLE "MaintenanceJob" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "assetId" TEXT NOT NULL REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "title" VARCHAR(140) NOT NULL,
  "description" TEXT NOT NULL,
  "status" "MaintenanceStatus" NOT NULL DEFAULT 'OPEN',
  "blocksOperation" BOOLEAN NOT NULL DEFAULT true,
  "dueAt" DATE,
  "responsibleUserId" TEXT REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "resolution" TEXT,
  "costCents" INTEGER CHECK ("costCents" IS NULL OR "costCents" >= 0),
  "resolvedAt" TIMESTAMP(3),
  "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" > 0),
  "createdByUserId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MaintenanceJob_resolution_check" CHECK ("status" NOT IN ('RESOLVED', 'CANCELLED') OR LENGTH(TRIM(COALESCE("resolution", ''))) >= 10)
);
CREATE INDEX "MaintenanceJob_assetId_status_idx" ON "MaintenanceJob"("assetId", "status");
CREATE INDEX "MaintenanceJob_status_dueAt_idx" ON "MaintenanceJob"("status", "dueAt");

CREATE TABLE "OperationalDocument" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "kind" "DocumentKind" NOT NULL,
  "status" "DocumentStatus" NOT NULL DEFAULT 'DRAFT',
  "title" VARCHAR(160) NOT NULL,
  "category" VARCHAR(80) NOT NULL,
  "body" TEXT NOT NULL,
  "externalUrl" VARCHAR(500),
  "shiftId" TEXT REFERENCES "Shift"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "incidentId" TEXT REFERENCES "Incident"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "publicationContext" JSONB,
  "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" > 0),
  "publishedAt" TIMESTAMP(3),
  "createdByUserId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OperationalDocument_subject_check" CHECK (
    ("kind" = 'PROTOCOL' AND "shiftId" IS NULL AND "incidentId" IS NULL) OR
    ("kind" = 'SHIFT_REPORT' AND "shiftId" IS NOT NULL AND "incidentId" IS NULL) OR
    ("kind" = 'INCIDENT_REPORT' AND "incidentId" IS NOT NULL AND "shiftId" IS NULL)
  )
);
CREATE INDEX "OperationalDocument_kind_status_idx" ON "OperationalDocument"("kind", "status");
CREATE INDEX "OperationalDocument_shiftId_idx" ON "OperationalDocument"("shiftId");
CREATE INDEX "OperationalDocument_incidentId_idx" ON "OperationalDocument"("incidentId");
