CREATE TYPE "ShiftPeriod" AS ENUM ('DAY', 'NIGHT');
ALTER TABLE "Shift" ADD COLUMN "period" "ShiftPeriod";

WITH ranked AS (
  SELECT "id",
    CASE WHEN "startTime" >= '18:00' THEN 'NIGHT'::"ShiftPeriod" ELSE 'DAY'::"ShiftPeriod" END AS candidate,
    ROW_NUMBER() OVER (
      PARTITION BY "date", CASE WHEN "startTime" >= '18:00' THEN 'NIGHT' ELSE 'DAY' END
      ORDER BY "createdAt", "id"
    ) AS row_number
  FROM "Shift"
)
UPDATE "Shift" shift
SET "period" = ranked.candidate
FROM ranked
WHERE shift."id" = ranked."id" AND ranked.row_number = 1;

UPDATE "Shift"
SET "startTime" = CASE WHEN "period" = 'DAY' THEN '08:00' ELSE '20:00' END,
    "endTime" = CASE WHEN "period" = 'DAY' THEN '20:00' ELSE '08:00' END,
    "shiftType" = CASE WHEN "period" = 'DAY' THEN 'Guardia diurna' ELSE 'Guardia nocturna' END
WHERE "period" IS NOT NULL;

CREATE UNIQUE INDEX "Shift_date_period_key" ON "Shift"("date", "period");
