-- 62: instituciones que participaron en una intervencion (otros cuarteles, policia, servicio medico, etc.).
CREATE TABLE "IncidentAgency" (
  "id" TEXT NOT NULL,
  "incidentId" TEXT NOT NULL,
  "agencyType" VARCHAR(20) NOT NULL,
  "name" VARCHAR(160) NOT NULL,
  "contactId" TEXT,
  "unit" VARCHAR(80) NOT NULL DEFAULT '',
  "inCharge" VARCHAR(120) NOT NULL DEFAULT '',
  "phone" VARCHAR(40),
  "arrivedAt" TIMESTAMP(3),
  "leftAt" TIMESTAMP(3),
  "notes" VARCHAR(2000) NOT NULL DEFAULT '',
  "createdByUserId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "voidedAt" TIMESTAMP(3),
  "voidReason" VARCHAR(1000),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "IncidentAgency_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "IncidentAgency_type_check" CHECK ("agencyType" IN ('FIRE_STATION', 'POLICE', 'MEDICAL', 'CIVIL_DEFENSE', 'UTILITY', 'MUNICIPAL', 'OTHER')),
  CONSTRAINT "IncidentAgency_times_check" CHECK ("leftAt" IS NULL OR "arrivedAt" IS NULL OR "leftAt" >= "arrivedAt"),
  CONSTRAINT "IncidentAgency_void_pair" CHECK (("voidedAt" IS NULL) = ("voidReason" IS NULL))
);
CREATE INDEX "IncidentAgency_incidentId_idx" ON "IncidentAgency"("incidentId");
CREATE INDEX "IncidentAgency_agencyType_idx" ON "IncidentAgency"("agencyType");
ALTER TABLE "IncidentAgency" ADD CONSTRAINT "IncidentAgency_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "IncidentAgency" ADD CONSTRAINT "IncidentAgency_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "OperationalContact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "IncidentAgency" ADD CONSTRAINT "IncidentAgency_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
