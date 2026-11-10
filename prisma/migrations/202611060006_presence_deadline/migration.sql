ALTER TABLE "Attendance" ADD COLUMN "promptShownAt" TIMESTAMP(3), ADD COLUMN "promptDueAt" TIMESTAMP(3);
CREATE INDEX "Attendance_open_prompt_idx" ON "Attendance"("promptShownAt") WHERE "status" = 'OPEN' AND "promptShownAt" IS NOT NULL;
