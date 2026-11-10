ALTER TABLE "Attendance" ADD COLUMN "presenceResumeAt" TIMESTAMP(3);
CREATE TABLE "VehicleDriverAuthorization" (
 "assetId" TEXT NOT NULL REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "requiredClass" VARCHAR(12) NOT NULL, "validUntil" DATE NOT NULL,
 "grantedByUserId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "reason" VARCHAR(1000) NOT NULL, "revision" INTEGER NOT NULL DEFAULT 1,
 PRIMARY KEY ("assetId","userId")
);
CREATE TABLE "MissionMovement" (
 "id" TEXT PRIMARY KEY, "incidentId" TEXT NOT NULL REFERENCES "Incident"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "assetId" TEXT NOT NULL REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "driverUserId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "leaderUserId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "createdByUserId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "departedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "arrivedAt" TIMESTAMP(3), "returnedAt" TIMESTAMP(3),
 "departureId" TEXT UNIQUE REFERENCES "VehicleDeparture"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CHECK ("arrivedAt" IS NULL OR "arrivedAt" >= "departedAt"),
 CHECK ("returnedAt" IS NULL OR ("arrivedAt" IS NOT NULL AND "returnedAt" >= "arrivedAt"))
);
CREATE INDEX "MissionMovement_incidentId_departedAt_idx" ON "MissionMovement"("incidentId","departedAt");
CREATE INDEX "MissionMovement_assetId_returnedAt_idx" ON "MissionMovement"("assetId","returnedAt");
CREATE UNIQUE INDEX "MissionMovement_active_vehicle" ON "MissionMovement"("assetId") WHERE "returnedAt" IS NULL;
CREATE TABLE "MissionCrew" (
 "movementId" TEXT NOT NULL REFERENCES "MissionMovement"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 PRIMARY KEY ("movementId","userId")
);
CREATE INDEX "MissionCrew_userId_idx" ON "MissionCrew"("userId");
