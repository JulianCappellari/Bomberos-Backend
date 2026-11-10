ALTER TABLE "WorkTask" ADD COLUMN "officerApproved" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "financeChief" BOOLEAN NOT NULL DEFAULT false;
UPDATE "WorkTask" w SET "officerApproved"=true FROM "FirefighterProfile" p WHERE w."reviewedByUserId"=p."userId" AND w."status"='VERIFIED' AND lower(p."rank")='oficial';
CREATE TABLE "ExpenseClaim" (
 "id" TEXT PRIMARY KEY,"operationKey" VARCHAR(36) NOT NULL UNIQUE,"userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT,
 "title" VARCHAR(160) NOT NULL,"notes" VARCHAR(2000) NOT NULL,"receiptUrl" VARCHAR(500),"occurredOn" DATE NOT NULL,
 "amountCents" INTEGER NOT NULL CHECK ("amountCents">0),"status" VARCHAR(16) NOT NULL DEFAULT 'PENDING' CHECK ("status" IN ('PENDING','APPROVED','REJECTED')),
 "reviewNote" VARCHAR(1000),"revision" INTEGER NOT NULL DEFAULT 1,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX "ExpenseClaim_status_createdAt_idx" ON "ExpenseClaim"("status","createdAt");
CREATE TABLE "ExpensePayment" (
 "id" TEXT PRIMARY KEY,"operationKey" VARCHAR(36) NOT NULL UNIQUE,"claimId" TEXT NOT NULL REFERENCES "ExpenseClaim"("id") ON DELETE RESTRICT,
 "amountCents" INTEGER NOT NULL CHECK ("amountCents">0),"reference" VARCHAR(500) NOT NULL,"reversedAt" TIMESTAMP(3),"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
