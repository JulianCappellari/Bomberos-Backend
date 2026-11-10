CREATE TABLE "OperationalContact" (
  "id" TEXT NOT NULL,
  "name" VARCHAR(140) NOT NULL,
  "category" VARCHAR(80) NOT NULL,
  "phone" VARCHAR(40),
  "radioFrequency" VARCHAR(80),
  "email" VARCHAR(120),
  "address" VARCHAR(200),
  "notes" TEXT,
  "isEmergency" BOOLEAN NOT NULL DEFAULT false,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "OperationalContact_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OperationalContact_channel_check" CHECK (
    NULLIF(TRIM("phone"), '') IS NOT NULL OR
    NULLIF(TRIM("radioFrequency"), '') IS NOT NULL OR
    NULLIF(TRIM("email"), '') IS NOT NULL
  ),
  CONSTRAINT "OperationalContact_revision_check" CHECK ("revision" >= 1)
);
CREATE INDEX "OperationalContact_deletedAt_category_idx" ON "OperationalContact"("deletedAt", "category");
CREATE INDEX "OperationalContact_isEmergency_name_idx" ON "OperationalContact"("isEmergency", "name");
ALTER TABLE "OperationalContact" ADD CONSTRAINT "OperationalContact_createdByUserId_fkey"
FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
