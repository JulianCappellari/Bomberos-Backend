ALTER TABLE "ExpenseClaim" ADD COLUMN "receiptBytes" BYTEA, ADD COLUMN "receiptSha256" VARCHAR(64);
ALTER TABLE "ExpenseClaim" ADD CONSTRAINT "ExpenseClaim_receipt_complete" CHECK (
  ("receiptBytes" IS NULL AND "receiptSha256" IS NULL) OR
  ("receiptBytes" IS NOT NULL AND "receiptSha256" IS NOT NULL AND "receiptSha256" ~ '^[0-9a-f]{64}$' AND octet_length("receiptBytes") BETWEEN 1 AND 250000)
);
CREATE INDEX "ExpenseClaim_receiptSha256_idx" ON "ExpenseClaim" ("receiptSha256");
