ALTER TABLE "Vehicle" ADD COLUMN "kind" VARCHAR(30) NOT NULL DEFAULT 'UNCLASSIFIED';
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_kind_valid" CHECK ("kind" IN ('UNCLASSIFIED','ENGINE','TANKER','RESCUE','AMBULANCE','SUPPORT','OTHER'));
ALTER TABLE "PersonalDeclaration" ADD COLUMN "licenseNumber" VARCHAR(80), ADD COLUMN "issuer" VARCHAR(160), ADD COLUMN "licenseClasses" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[], ADD COLUMN "issuedOn" DATE, ADD COLUMN "expiresOn" DATE;
ALTER TABLE "PersonalDeclaration" ADD CONSTRAINT "PersonalDeclaration_license_dates" CHECK ("issuedOn" IS NULL OR "expiresOn" IS NULL OR "expiresOn" >= "issuedOn");
CREATE TABLE "ServiceParticipation" (
 "id" TEXT PRIMARY KEY, "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "shiftId" TEXT REFERENCES "Shift"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "incidentId" TEXT REFERENCES "Incident"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "startedAt" TIMESTAMP(3) NOT NULL, "endedAt" TIMESTAMP(3) NOT NULL, "notes" VARCHAR(2000) NOT NULL,
 "registeredByUserId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" > 0), "cancelledAt" TIMESTAMP(3), "cancelReason" VARCHAR(2000),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "ServiceParticipation_subject" CHECK (("shiftId" IS NULL) <> ("incidentId" IS NULL)),
 CONSTRAINT "ServiceParticipation_interval" CHECK ("endedAt" > "startedAt"),
 CONSTRAINT "ServiceParticipation_cancellation" CHECK (("cancelledAt" IS NULL) = ("cancelReason" IS NULL))
);
CREATE INDEX "ServiceParticipation_userId_startedAt_idx" ON "ServiceParticipation"("userId","startedAt");
CREATE UNIQUE INDEX "ServiceParticipation_active_shift" ON "ServiceParticipation"("userId","shiftId") WHERE "cancelledAt" IS NULL AND "shiftId" IS NOT NULL;
CREATE UNIQUE INDEX "ServiceParticipation_active_incident" ON "ServiceParticipation"("userId","incidentId") WHERE "cancelledAt" IS NULL AND "incidentId" IS NOT NULL;
