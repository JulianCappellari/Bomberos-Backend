-- Deposito del cuartel: stock, movimientos y pedidos de materiales.
CREATE TABLE "SupplyItem" (
  "id" TEXT NOT NULL,
  "name" VARCHAR(140) NOT NULL,
  "category" VARCHAR(30) NOT NULL,
  "size" VARCHAR(30),
  "unit" VARCHAR(20) NOT NULL DEFAULT 'unidad',
  "quantity" INTEGER NOT NULL DEFAULT 0,
  "minQuantity" INTEGER NOT NULL DEFAULT 0,
  "location" VARCHAR(120),
  "notes" VARCHAR(1000),
  "revision" INTEGER NOT NULL DEFAULT 1,
  "archivedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SupplyItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SupplyItem_quantity_check" CHECK ("quantity" >= 0 AND "minQuantity" >= 0)
);
CREATE INDEX "SupplyItem_archivedAt_category_idx" ON "SupplyItem"("archivedAt", "category");

CREATE TABLE "SupplyMovement" (
  "id" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "type" VARCHAR(10) NOT NULL,
  "quantity" INTEGER NOT NULL,
  "balanceAfter" INTEGER NOT NULL,
  "reason" VARCHAR(500) NOT NULL,
  "assignedUserId" TEXT,
  "vehicleId" TEXT,
  "requestId" TEXT,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SupplyMovement_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SupplyMovement_itemId_createdAt_idx" ON "SupplyMovement"("itemId", "createdAt");
CREATE INDEX "SupplyMovement_createdAt_idx" ON "SupplyMovement"("createdAt");
ALTER TABLE "SupplyMovement" ADD CONSTRAINT "SupplyMovement_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "SupplyItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "MaterialRequest" (
  "id" TEXT NOT NULL,
  "title" VARCHAR(160) NOT NULL,
  "details" VARCHAR(2000),
  "destination" VARCHAR(10) NOT NULL,
  "vehicleId" TEXT,
  "quantity" INTEGER NOT NULL DEFAULT 1,
  "priority" VARCHAR(10) NOT NULL DEFAULT 'NORMAL',
  "status" VARCHAR(12) NOT NULL DEFAULT 'PENDING',
  "requestedByUserId" TEXT NOT NULL,
  "handledByUserId" TEXT,
  "handledAt" TIMESTAMP(3),
  "handlerNotes" VARCHAR(2000),
  "supplyItemId" TEXT,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MaterialRequest_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "MaterialRequest_status_createdAt_idx" ON "MaterialRequest"("status", "createdAt");
CREATE INDEX "MaterialRequest_requestedByUserId_createdAt_idx" ON "MaterialRequest"("requestedByUserId", "createdAt");
ALTER TABLE "MaterialRequest" ADD CONSTRAINT "MaterialRequest_supplyItemId_fkey" FOREIGN KEY ("supplyItemId") REFERENCES "SupplyItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
