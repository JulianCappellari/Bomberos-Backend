ALTER TABLE "FuelRecord" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1,
 ADD COLUMN "replacesId" TEXT UNIQUE REFERENCES "FuelRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 ADD COLUMN "correctionReason" VARCHAR(1000);
ALTER TABLE "WaterTrip"
 ADD COLUMN "replacesId" TEXT UNIQUE REFERENCES "WaterTrip"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 ADD COLUMN "correctionReason" VARCHAR(1000);
ALTER TABLE "FuelRecord" ADD CONSTRAINT "FuelRecord_correction_pair" CHECK (("replacesId" IS NULL)=("correctionReason" IS NULL));
ALTER TABLE "WaterTrip" ADD CONSTRAINT "WaterTrip_correction_pair" CHECK (("replacesId" IS NULL)=("correctionReason" IS NULL));
