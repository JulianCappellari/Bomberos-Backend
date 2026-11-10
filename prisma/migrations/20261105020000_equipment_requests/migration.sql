CREATE TYPE "EquipmentRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'FULFILLED', 'CANCELLED');
CREATE TABLE "PersonalEquipmentRequest" (
  "id" TEXT NOT NULL PRIMARY KEY, "userId" TEXT NOT NULL, "category" VARCHAR(40) NOT NULL,
  "size" VARCHAR(30), "reason" VARCHAR(2000) NOT NULL,
  "status" "EquipmentRequestStatus" NOT NULL DEFAULT 'PENDING', "revision" INTEGER NOT NULL DEFAULT 1,
  "reviewedByUserId" TEXT, "reviewedAt" TIMESTAMP(3), "reviewNotes" VARCHAR(2000),
  "fulfilledIssueId" TEXT, "fulfilledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PersonalEquipmentRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PersonalEquipmentRequest_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PersonalEquipmentRequest_fulfilledIssueId_fkey" FOREIGN KEY ("fulfilledIssueId") REFERENCES "PersonalEquipmentIssue"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PersonalEquipmentRequest_revision_positive" CHECK ("revision" >= 1),
  CONSTRAINT "PersonalEquipmentRequest_review_consistent" CHECK ("status" NOT IN ('APPROVED', 'REJECTED', 'FULFILLED') OR ("reviewedByUserId" IS NOT NULL AND "reviewedAt" IS NOT NULL)),
  CONSTRAINT "PersonalEquipmentRequest_fulfillment_consistent" CHECK (("status" = 'FULFILLED' AND "fulfilledIssueId" IS NOT NULL AND "fulfilledAt" IS NOT NULL) OR ("status" <> 'FULFILLED' AND "fulfilledIssueId" IS NULL AND "fulfilledAt" IS NULL))
);
CREATE UNIQUE INDEX "PersonalEquipmentRequest_fulfilledIssueId_key" ON "PersonalEquipmentRequest"("fulfilledIssueId");
CREATE INDEX "PersonalEquipmentRequest_userId_status_createdAt_idx" ON "PersonalEquipmentRequest"("userId", "status", "createdAt");
CREATE INDEX "PersonalEquipmentRequest_status_createdAt_idx" ON "PersonalEquipmentRequest"("status", "createdAt");
CREATE UNIQUE INDEX "PersonalEquipmentRequest_one_active_category" ON "PersonalEquipmentRequest"("userId", "category") WHERE "status" IN ('PENDING', 'APPROVED');
