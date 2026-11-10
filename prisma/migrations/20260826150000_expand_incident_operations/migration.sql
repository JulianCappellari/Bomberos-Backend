ALTER TABLE "Incident"
ADD COLUMN "location" VARCHAR(180),
ADD COLUMN "responseTimeMinutes" INTEGER,
ADD COLUMN "closingReport" TEXT;

UPDATE "Incident" i
SET "location" = COALESCE(
  NULLIF(TRIM(a."location"), ''),
  'Ubicacion no informada'
)
FROM "Alert" a
WHERE i."alertId" = a."id";

UPDATE "Incident"
SET "location" = 'Ubicacion no informada'
WHERE "location" IS NULL;

ALTER TABLE "Incident" ALTER COLUMN "location" SET NOT NULL;

ALTER TABLE "Incident"
ADD CONSTRAINT "Incident_responseTimeMinutes_check"
CHECK ("responseTimeMinutes" IS NULL OR "responseTimeMinutes" BETWEEN 1 AND 999);

CREATE TABLE "IncidentVehicle" (
  "id" TEXT NOT NULL,
  "incidentId" TEXT NOT NULL,
  "assetId" TEXT NOT NULL,
  "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "IncidentVehicle_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "IncidentUpdate" (
  "id" TEXT NOT NULL,
  "incidentId" TEXT NOT NULL,
  "authorUserId" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "IncidentUpdate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "IncidentVehicle_incidentId_assetId_key" ON "IncidentVehicle"("incidentId", "assetId");
CREATE INDEX "IncidentVehicle_assetId_idx" ON "IncidentVehicle"("assetId");
CREATE INDEX "IncidentUpdate_incidentId_createdAt_idx" ON "IncidentUpdate"("incidentId", "createdAt");
CREATE INDEX "IncidentUpdate_authorUserId_idx" ON "IncidentUpdate"("authorUserId");
CREATE INDEX "IncidentUpdate_deletedAt_idx" ON "IncidentUpdate"("deletedAt");

ALTER TABLE "IncidentVehicle" ADD CONSTRAINT "IncidentVehicle_incidentId_fkey"
FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IncidentVehicle" ADD CONSTRAINT "IncidentVehicle_assetId_fkey"
FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "IncidentUpdate" ADD CONSTRAINT "IncidentUpdate_incidentId_fkey"
FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IncidentUpdate" ADD CONSTRAINT "IncidentUpdate_authorUserId_fkey"
FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
