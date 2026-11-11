-- Cuentas de guardia propias vinculadas a la persona titular.
ALTER TABLE "User" ADD COLUMN "guardForUserId" TEXT;
CREATE UNIQUE INDEX "User_guardForUserId_key" ON "User"("guardForUserId");
ALTER TABLE "User" ADD CONSTRAINT "User_guardForUserId_fkey" FOREIGN KEY ("guardForUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- La guardia deja de ser un "modo" de la cuenta personal: se cierran esos modos.
UPDATE "AuthSession" SET "guardMode" = false WHERE "guardMode" = true;

-- Base sin ubicacion para fichar con QR mientras tanto.
ALTER TABLE "Station" ADD COLUMN "requiresLocation" BOOLEAN NOT NULL DEFAULT true;
INSERT INTO "Station" ("id", "name", "latitude", "longitude", "radiusMeters", "requiresLocation", "createdAt", "updatedAt")
SELECT 'base-sin-ubicacion', 'Base sin ubicación', 0, 0, 60, false, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Station" WHERE "id" = 'base-sin-ubicacion');
