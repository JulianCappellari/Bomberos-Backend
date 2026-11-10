ALTER TABLE "Inspection"
ADD COLUMN "leaderUserId" TEXT,
ADD COLUMN "createdByUserId" TEXT,
ADD COLUMN "resultingAssetStatus" "AssetStatus";

ALTER TABLE "InspectionItem"
ADD COLUMN "observedQuantity" INTEGER NOT NULL DEFAULT 0;

UPDATE "InspectionItem"
SET "observedQuantity" = CASE
  WHEN "result" = 'MISSING' THEN 0
  ELSE "expectedQuantity"
END;

UPDATE "Inspection" i
SET "leaderUserId" = r."userId",
    "createdByUserId" = r."userId"
FROM (
  SELECT DISTINCT ON ("inspectionId") "inspectionId", "userId"
  FROM "InspectionResponsible"
  ORDER BY "inspectionId", "assignedAt", "id"
) r
WHERE r."inspectionId" = i."id";

UPDATE "Inspection"
SET "resultingAssetStatus" = CASE
  WHEN "summaryMissing" > 0 OR "summaryDamaged" > 0 OR "summaryUnchecked" > 0
    THEN 'MAINTENANCE'::"AssetStatus"
  ELSE 'OPERATIONAL'::"AssetStatus"
END;

ALTER TABLE "InspectionItem"
ADD CONSTRAINT "InspectionItem_observedQuantity_check" CHECK ("observedQuantity" >= 0);

CREATE INDEX "Inspection_leaderUserId_idx" ON "Inspection"("leaderUserId");
CREATE INDEX "Inspection_createdByUserId_idx" ON "Inspection"("createdByUserId");

ALTER TABLE "Inspection" ADD CONSTRAINT "Inspection_leaderUserId_fkey"
FOREIGN KEY ("leaderUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Inspection" ADD CONSTRAINT "Inspection_createdByUserId_fkey"
FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
