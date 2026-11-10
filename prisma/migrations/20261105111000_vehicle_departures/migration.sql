CREATE TABLE "VehicleDeparture" (
 "id" TEXT PRIMARY KEY, "operationKey" UUID NOT NULL, "requestHash" VARCHAR(64) NOT NULL,
 "assetId" TEXT NOT NULL REFERENCES "Asset"("id") ON UPDATE CASCADE ON DELETE RESTRICT,
 "departedAt" TIMESTAMP(3) NOT NULL, "returnedAt" TIMESTAMP(3) NOT NULL,
 "purpose" VARCHAR(200) NOT NULL, "notes" VARCHAR(2000) NOT NULL,
 "createdByUserId" TEXT NOT NULL REFERENCES "User"("id") ON UPDATE CASCADE ON DELETE RESTRICT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "revision" INTEGER NOT NULL DEFAULT 1, "voidedAt" TIMESTAMP(3), "voidReason" VARCHAR(2000),
 CHECK ("returnedAt" > "departedAt"), CHECK ("revision" > 0),
 CHECK (("voidedAt" IS NULL) = ("voidReason" IS NULL))
);
CREATE UNIQUE INDEX "VehicleDeparture_operationKey_key" ON "VehicleDeparture"("operationKey");
CREATE INDEX "VehicleDeparture_assetId_departedAt_idx" ON "VehicleDeparture"("assetId", "departedAt");
CREATE TABLE "DepartureMember" (
 "departureId" TEXT NOT NULL REFERENCES "VehicleDeparture"("id") ON UPDATE CASCADE ON DELETE RESTRICT,
 "userId" TEXT NOT NULL REFERENCES "User"("id") ON UPDATE CASCADE ON DELETE RESTRICT,
 "isLeader" BOOLEAN NOT NULL DEFAULT false, PRIMARY KEY ("departureId", "userId")
);
CREATE INDEX "DepartureMember_userId_idx" ON "DepartureMember"("userId");
CREATE UNIQUE INDEX "DepartureMember_one_leader" ON "DepartureMember"("departureId") WHERE "isLeader";
