ALTER TABLE "VehicleCompartment" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "VehicleInventoryItem" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "labelCode" VARCHAR(40), ADD COLUMN "expiresOn" DATE;
CREATE UNIQUE INDEX "VehicleInventoryItem_labelCode_key" ON "VehicleInventoryItem"("labelCode");
ALTER TABLE "InspectionItem" ADD COLUMN "foundElsewhere" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "foundLocation" VARCHAR(200);
ALTER TABLE "MemberNotification" ADD COLUMN "body" VARCHAR(2000);
ALTER TABLE "InspectionItem" ADD CONSTRAINT "InspectionItem_location_check"
  CHECK (("foundElsewhere" AND "foundLocation" IS NOT NULL AND length(trim("foundLocation")) >= 3)
    OR (NOT "foundElsewhere" AND "foundLocation" IS NULL));
