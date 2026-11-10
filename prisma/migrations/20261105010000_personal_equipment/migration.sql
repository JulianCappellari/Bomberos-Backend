CREATE TYPE "EquipmentCondition" AS ENUM ('OK', 'REVIEW', 'OUT');
CREATE TABLE "PersonalEquipment" (
  "id" TEXT NOT NULL PRIMARY KEY, "assetId" TEXT NOT NULL, "code" VARCHAR(40) NOT NULL,
  "category" VARCHAR(40) NOT NULL, "size" VARCHAR(30), "revision" INTEGER NOT NULL DEFAULT 1,
  "archivedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PersonalEquipment_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PersonalEquipment_revision_positive" CHECK ("revision" >= 1)
);
CREATE UNIQUE INDEX "PersonalEquipment_assetId_key" ON "PersonalEquipment"("assetId");
CREATE UNIQUE INDEX "PersonalEquipment_code_key" ON "PersonalEquipment"("code");
CREATE INDEX "PersonalEquipment_archivedAt_category_idx" ON "PersonalEquipment"("archivedAt", "category");
CREATE TABLE "PersonalEquipmentIssue" (
  "id" TEXT NOT NULL PRIMARY KEY, "equipmentId" TEXT NOT NULL, "userId" TEXT NOT NULL,
  "issuedByUserId" TEXT NOT NULL, "receivedByUserId" TEXT,
  "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "returnedAt" TIMESTAMP(3),
  "issueNotes" VARCHAR(2000), "returnNotes" VARCHAR(2000), "returnCondition" "EquipmentCondition",
  CONSTRAINT "PersonalEquipmentIssue_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "PersonalEquipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PersonalEquipmentIssue_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PersonalEquipmentIssue_issuedByUserId_fkey" FOREIGN KEY ("issuedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PersonalEquipmentIssue_receivedByUserId_fkey" FOREIGN KEY ("receivedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PersonalEquipmentIssue_return_consistent" CHECK (("returnedAt" IS NULL AND "receivedByUserId" IS NULL AND "returnCondition" IS NULL) OR ("returnedAt" >= "issuedAt" AND "receivedByUserId" IS NOT NULL AND "returnCondition" IS NOT NULL))
);
-- One physical article cannot be held by two people, even under concurrent requests.
CREATE UNIQUE INDEX "PersonalEquipmentIssue_one_open_per_item" ON "PersonalEquipmentIssue"("equipmentId") WHERE "returnedAt" IS NULL;
CREATE INDEX "PersonalEquipmentIssue_userId_returnedAt_idx" ON "PersonalEquipmentIssue"("userId", "returnedAt");
CREATE INDEX "PersonalEquipmentIssue_equipmentId_issuedAt_idx" ON "PersonalEquipmentIssue"("equipmentId", "issuedAt");
CREATE TABLE "PersonalEquipmentCheck" (
  "id" TEXT NOT NULL PRIMARY KEY, "equipmentId" TEXT NOT NULL, "checkedByUserId" TEXT NOT NULL,
  "condition" "EquipmentCondition" NOT NULL, "notes" VARCHAR(2000) NOT NULL,
  "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PersonalEquipmentCheck_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "PersonalEquipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PersonalEquipmentCheck_checkedByUserId_fkey" FOREIGN KEY ("checkedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "PersonalEquipmentCheck_equipmentId_checkedAt_idx" ON "PersonalEquipmentCheck"("equipmentId", "checkedAt");
