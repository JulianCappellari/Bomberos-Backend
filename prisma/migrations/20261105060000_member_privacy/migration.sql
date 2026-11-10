CREATE TABLE "PersonalDeclaration" (
 "id" TEXT PRIMARY KEY, "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "category" VARCHAR(30) NOT NULL CHECK ("category" IN ('CLOTHING','DRIVER_LICENSE')),
 "title" VARCHAR(160) NOT NULL, "details" VARCHAR(4000) NOT NULL, "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" > 0),
 "deletedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "PersonalDeclaration_userId_category_deletedAt_idx" ON "PersonalDeclaration"("userId","category","deletedAt");
CREATE TABLE "EmergencyAvailability" (
 "id" TEXT PRIMARY KEY, "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "startsAt" TIMESTAMP(3) NOT NULL, "endsAt" TIMESTAMP(3), "cancelledAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "EmergencyAvailability_range" CHECK ("endsAt" IS NULL OR "endsAt" > "startsAt")
);
CREATE INDEX "EmergencyAvailability_userId_startsAt_endsAt_idx" ON "EmergencyAvailability"("userId","startsAt","endsAt");
CREATE TABLE "ChatAcknowledgement" (
 "id" TEXT PRIMARY KEY, "messageId" TEXT NOT NULL REFERENCES "ChatMessage"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "contentHash" VARCHAR(64) NOT NULL, "bodySnapshot" VARCHAR(4000) NOT NULL, "acknowledgedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "ChatAcknowledgement_messageId_userId_contentHash_key" ON "ChatAcknowledgement"("messageId","userId","contentHash");
