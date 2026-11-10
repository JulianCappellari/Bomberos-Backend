ALTER TABLE "DispatchNotice" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1, ADD COLUMN "cancelledAt" TIMESTAMP(3), ADD COLUMN "cancelReason" VARCHAR(1000);
ALTER TABLE "VehicleDriverAuthorization" ADD COLUMN "licenseId" TEXT REFERENCES "PersonalDeclaration"("id") ON DELETE RESTRICT, ADD COLUMN "licenseRevision" INTEGER;
