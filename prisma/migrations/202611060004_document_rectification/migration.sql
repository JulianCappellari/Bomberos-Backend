ALTER TABLE "OperationalDocument" ADD COLUMN "sourceDocumentId" TEXT;
ALTER TABLE "OperationalDocument" ADD CONSTRAINT "OperationalDocument_sourceDocumentId_fkey" FOREIGN KEY ("sourceDocumentId") REFERENCES "OperationalDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE UNIQUE INDEX "OperationalDocument_one_draft_rectification" ON "OperationalDocument"("sourceDocumentId") WHERE "status" = 'DRAFT' AND "sourceDocumentId" IS NOT NULL;
