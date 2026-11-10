CREATE TABLE "WorkPhoto" (
 "id" TEXT PRIMARY KEY, "taskId" TEXT NOT NULL REFERENCES "WorkTask"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "submissionRevision" INTEGER NOT NULL CHECK ("submissionRevision" > 0),
 "bytes" BYTEA NOT NULL CHECK (octet_length("bytes") <= 250000), "sha256" VARCHAR(64) NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "WorkPhoto_taskId_submissionRevision_idx" ON "WorkPhoto"("taskId", "submissionRevision");
