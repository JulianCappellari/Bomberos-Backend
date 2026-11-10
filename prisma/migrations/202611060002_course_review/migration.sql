CREATE TYPE "CourseReviewStatus" AS ENUM ('PENDING','APPROVED','REJECTED');
CREATE TABLE "CourseAttendance" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "title" VARCHAR(160) NOT NULL, "provider" VARCHAR(160) NOT NULL,
  "completedOn" DATE NOT NULL,
  "status" "CourseReviewStatus" NOT NULL DEFAULT 'PENDING',
  "reviewerId" TEXT REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "reviewedAt" TIMESTAMP(3), "reviewNote" VARCHAR(1000),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (("status" = 'PENDING' AND "reviewerId" IS NULL AND "reviewedAt" IS NULL)
      OR ("status" <> 'PENDING' AND "reviewerId" IS NOT NULL AND "reviewerId" <> "userId" AND "reviewedAt" IS NOT NULL))
);
CREATE INDEX "CourseAttendance_userId_createdAt_idx" ON "CourseAttendance"("userId","createdAt");
CREATE INDEX "CourseAttendance_status_createdAt_idx" ON "CourseAttendance"("status","createdAt");
