ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'GUARD';
ALTER TABLE "PersonalDeclaration" ADD COLUMN "clothingBrand" VARCHAR(120), ADD COLUMN "clothingModel" VARCHAR(120),
 ADD COLUMN "clothingSize" VARCHAR(40), ADD COLUMN "clothingCondition" VARCHAR(20), ADD COLUMN "clothingNovelties" VARCHAR(2000);
ALTER TABLE "WorkTask" ADD COLUMN "maintenanceJobId" TEXT REFERENCES "MaintenanceJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE UNIQUE INDEX "WorkTask_maintenanceJobId_key" ON "WorkTask"("maintenanceJobId");
ALTER TABLE "ServiceParticipation" ADD COLUMN "verifiedAt" TIMESTAMP(3);
UPDATE "ServiceParticipation" SET "verifiedAt" = "createdAt";
