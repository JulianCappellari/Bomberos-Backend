ALTER TABLE "Inspection" ADD COLUMN "confirmationsComplete" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Inspection" ADD COLUMN "repairTaskId" TEXT;
ALTER TABLE "InspectionResponsible" ADD COLUMN "confirmedAt" TIMESTAMP(3);
ALTER TABLE "WorkTask" ADD COLUMN "priority" VARCHAR(16) NOT NULL DEFAULT 'NORMAL';
CREATE UNIQUE INDEX "Inspection_repairTaskId_key" ON "Inspection"("repairTaskId");
ALTER TABLE "Inspection" ADD CONSTRAINT "Inspection_repairTaskId_fkey" FOREIGN KEY ("repairTaskId") REFERENCES "WorkTask"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
