ALTER TABLE "MissionMovement" ADD COLUMN "returnWithoutArrivalReason" VARCHAR(1000);
DO $$
DECLARE original_check TEXT;
BEGIN
 SELECT conname INTO STRICT original_check FROM pg_constraint
 WHERE conrelid = '"MissionMovement"'::regclass AND contype='c'
 AND pg_get_constraintdef(oid) LIKE '%"returnedAt"%';
 EXECUTE format('ALTER TABLE "MissionMovement" DROP CONSTRAINT %I', original_check);
END $$;
ALTER TABLE "MissionMovement" ADD CONSTRAINT "MissionMovement_return_chronology" CHECK (
 ("returnedAt" IS NULL AND "returnWithoutArrivalReason" IS NULL) OR
 ("returnedAt" IS NOT NULL AND "returnedAt" >= "departedAt" AND (
    ("arrivedAt" IS NOT NULL AND "returnedAt" >= "arrivedAt" AND "returnWithoutArrivalReason" IS NULL) OR
    ("arrivedAt" IS NULL AND "returnWithoutArrivalReason" IS NOT NULL AND length(trim("returnWithoutArrivalReason")) >= 10)
 ))
);
