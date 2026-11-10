CREATE TYPE "ComplianceSubjectType" AS ENUM ('USER', 'ASSET');
CREATE TYPE "ComplianceCategory" AS ENUM ('TRAINING', 'CERTIFICATION', 'MEDICAL_EXAM', 'DRIVER_LICENSE', 'INSURANCE', 'VTV', 'SERVICE', 'SCBA_SERVICE', 'OTHER');

CREATE TABLE "ComplianceRecord" (
  "id" TEXT NOT NULL,
  "subjectType" "ComplianceSubjectType" NOT NULL,
  "userId" TEXT,
  "assetId" TEXT,
  "category" "ComplianceCategory" NOT NULL,
  "title" VARCHAR(140) NOT NULL,
  "issuer" VARCHAR(140),
  "issuedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3),
  "warningDays" INTEGER NOT NULL DEFAULT 30,
  "documentUrl" VARCHAR(500),
  "notes" TEXT,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "ComplianceRecord_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ComplianceRecord_subject_check" CHECK (
    ("subjectType" = 'USER' AND "userId" IS NOT NULL AND "assetId" IS NULL) OR
    ("subjectType" = 'ASSET' AND "assetId" IS NOT NULL AND "userId" IS NULL)
  ),
  CONSTRAINT "ComplianceRecord_warning_days_check" CHECK ("warningDays" BETWEEN 0 AND 3650),
  CONSTRAINT "ComplianceRecord_date_order_check" CHECK ("issuedAt" IS NULL OR "expiresAt" IS NULL OR "expiresAt" >= "issuedAt")
);

CREATE INDEX "ComplianceRecord_subjectType_category_idx" ON "ComplianceRecord"("subjectType", "category");
CREATE INDEX "ComplianceRecord_userId_idx" ON "ComplianceRecord"("userId");
CREATE INDEX "ComplianceRecord_assetId_idx" ON "ComplianceRecord"("assetId");
CREATE INDEX "ComplianceRecord_expiresAt_idx" ON "ComplianceRecord"("expiresAt");
CREATE INDEX "ComplianceRecord_deletedAt_idx" ON "ComplianceRecord"("deletedAt");

ALTER TABLE "ComplianceRecord" ADD CONSTRAINT "ComplianceRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ComplianceRecord" ADD CONSTRAINT "ComplianceRecord_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ComplianceRecord" ADD CONSTRAINT "ComplianceRecord_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
