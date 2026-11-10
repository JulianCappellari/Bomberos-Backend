CREATE TABLE "AirCylinder" (
 "id" TEXT PRIMARY KEY, "assetId" TEXT NOT NULL UNIQUE, "code" VARCHAR(40) NOT NULL UNIQUE,
 "serialNumber" VARCHAR(100) NOT NULL UNIQUE, "ratedPressureBar" INTEGER NOT NULL, "pressureBar" INTEGER,
 "vehicleAssetId" TEXT, "externalOwner" VARCHAR(140), "revision" INTEGER NOT NULL DEFAULT 1,
 "reviewedAt" TIMESTAMP(3), "lastEventAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "retiredAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 FOREIGN KEY ("vehicleAssetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "AirCylinder_pressure_valid" CHECK ("ratedPressureBar" BETWEEN 1 AND 1000 AND ("pressureBar" IS NULL OR "pressureBar" BETWEEN 0 AND "ratedPressureBar")),
 CHECK ("revision" >= 1)
);
CREATE TABLE "AirHydroTest" (
 "id" TEXT PRIMARY KEY, "cylinderId" TEXT NOT NULL, "result" VARCHAR(10) NOT NULL,
 "testedOn" DATE NOT NULL, "validUntil" DATE, "certificateReference" VARCHAR(200) NOT NULL,
 "notes" VARCHAR(2000) NOT NULL, "registeredByUserId" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY ("cylinderId") REFERENCES "AirCylinder"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 FOREIGN KEY ("registeredByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "AirHydroTest_result_valid" CHECK (("result" = 'PASS' AND "validUntil" IS NOT NULL AND "validUntil" >= "testedOn") OR ("result" = 'FAIL' AND "validUntil" IS NULL))
);
CREATE UNIQUE INDEX "AirHydroTest_cylinderId_certificateReference_key" ON "AirHydroTest"("cylinderId", "certificateReference");
CREATE INDEX "AirHydroTest_cylinderId_testedOn_createdAt_idx" ON "AirHydroTest"("cylinderId", "testedOn", "createdAt");
CREATE TABLE "AirCompressor" (
 "id" TEXT PRIMARY KEY, "assetId" TEXT NOT NULL UNIQUE, "code" VARCHAR(40) NOT NULL UNIQUE,
 "maxPressureBar" INTEGER NOT NULL, "totalRunMinutes" INTEGER NOT NULL DEFAULT 0, "filterBaselineMinutes" INTEGER NOT NULL DEFAULT 0,
 "filterLifeMinutes" INTEGER NOT NULL, "filterReference" VARCHAR(200) NOT NULL, "filterInstalledAt" TIMESTAMP(3) NOT NULL,
 "airQualityReference" VARCHAR(200), "airQualityValidUntil" DATE, "reviewedAt" TIMESTAMP(3), "lastRunEndedAt" TIMESTAMP(3),
 "retiredAt" TIMESTAMP(3), "revision" INTEGER NOT NULL DEFAULT 1, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "AirCompressor_counters_valid" CHECK ("maxPressureBar" BETWEEN 1 AND 1000 AND "totalRunMinutes" >= 0 AND "filterBaselineMinutes" BETWEEN 0 AND "totalRunMinutes" AND "filterLifeMinutes" > 0 AND "revision" >= 1)
);
CREATE TABLE "AirFill" (
 "id" TEXT PRIMARY KEY, "operationKey" VARCHAR(36) NOT NULL UNIQUE, "requestHash" VARCHAR(64) NOT NULL, "compressorId" TEXT NOT NULL,
 "startedAt" TIMESTAMP(3) NOT NULL, "endedAt" TIMESTAMP(3) NOT NULL, "runMinutes" INTEGER NOT NULL,
 "operatorUserId" TEXT NOT NULL, "createdByUserId" TEXT NOT NULL, "reason" VARCHAR(40) NOT NULL, "notes" VARCHAR(2000) NOT NULL,
 "compressorSnapshot" JSONB NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY ("compressorId") REFERENCES "AirCompressor"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 FOREIGN KEY ("operatorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "AirFill_duration_valid" CHECK ("endedAt" > "startedAt" AND "runMinutes" = CEIL(EXTRACT(EPOCH FROM ("endedAt" - "startedAt")) / 60) AND "runMinutes" BETWEEN 1 AND 1440)
);
CREATE INDEX "AirFill_compressorId_startedAt_idx" ON "AirFill"("compressorId", "startedAt");
CREATE TABLE "AirFillItem" (
 "id" TEXT PRIMARY KEY, "fillId" TEXT NOT NULL, "cylinderId" TEXT NOT NULL, "pressureBar" INTEGER NOT NULL,
 "previousPressureBar" INTEGER, "cylinderSnapshot" JSONB NOT NULL,
 FOREIGN KEY ("fillId") REFERENCES "AirFill"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 FOREIGN KEY ("cylinderId") REFERENCES "AirCylinder"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CHECK ("pressureBar" > 0 AND ("previousPressureBar" IS NULL OR "previousPressureBar" >= 0))
);
CREATE UNIQUE INDEX "AirFillItem_fillId_cylinderId_key" ON "AirFillItem"("fillId", "cylinderId");
CREATE INDEX "AirFillItem_cylinderId_idx" ON "AirFillItem"("cylinderId");
CREATE TABLE "AirFillHelper" (
 "fillId" TEXT NOT NULL, "userId" TEXT NOT NULL, PRIMARY KEY ("fillId", "userId"),
 FOREIGN KEY ("fillId") REFERENCES "AirFill"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE TABLE "AirFilterChange" (
 "id" TEXT PRIMARY KEY, "compressorId" TEXT NOT NULL, "totalMinutesSnapshot" INTEGER NOT NULL,
 "previousBaselineMinutes" INTEGER NOT NULL, "previousLifeMinutes" INTEGER NOT NULL, "previousReference" VARCHAR(200) NOT NULL,
 "newLifeMinutes" INTEGER NOT NULL, "newReference" VARCHAR(200) NOT NULL, "notes" VARCHAR(2000) NOT NULL,
 "changedByUserId" TEXT NOT NULL, "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY ("compressorId") REFERENCES "AirCompressor"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 FOREIGN KEY ("changedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CHECK ("totalMinutesSnapshot" >= "previousBaselineMinutes" AND "previousBaselineMinutes" >= 0 AND "previousLifeMinutes" > 0 AND "newLifeMinutes" > 0)
);
CREATE INDEX "AirFilterChange_compressorId_changedAt_idx" ON "AirFilterChange"("compressorId", "changedAt");
