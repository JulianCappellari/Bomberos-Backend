/*
  Warnings:

  - You are about to drop the column `responsibleUserId` on the `Inspection` table. All the data in the column will be lost.
  - You are about to drop the column `compartment` on the `VehicleInventoryItem` table. All the data in the column will be lost.
  - You are about to drop the column `quantity` on the `VehicleInventoryItem` table. All the data in the column will be lost.
  - You are about to drop the column `vehicleId` on the `VehicleInventoryItem` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[unitNumber]` on the table `Vehicle` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `unitNumber` to the `Vehicle` table without a default value. This is not possible if the table is not empty.
  - Added the required column `compartmentId` to the `VehicleInventoryItem` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "Inspection" DROP CONSTRAINT "Inspection_responsibleUserId_fkey";

-- DropForeignKey
ALTER TABLE "VehicleInventoryItem" DROP CONSTRAINT "VehicleInventoryItem_vehicleId_fkey";

-- DropIndex
DROP INDEX "VehicleInventoryItem_vehicleId_idx";

-- AlterTable
ALTER TABLE "Inspection" DROP COLUMN "responsibleUserId";

-- AlterTable
ALTER TABLE "Vehicle" ADD COLUMN     "unitNumber" VARCHAR(20) NOT NULL;

-- AlterTable
ALTER TABLE "VehicleInventoryItem" DROP COLUMN "compartment",
DROP COLUMN "quantity",
DROP COLUMN "vehicleId",
ADD COLUMN     "compartmentId" TEXT NOT NULL,
ADD COLUMN     "expectedQuantity" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "VehicleCompartment" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" VARCHAR(255),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VehicleCompartment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InspectionResponsible" (
    "id" TEXT NOT NULL,
    "inspectionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InspectionResponsible_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VehicleCompartment_vehicleId_sortOrder_idx" ON "VehicleCompartment"("vehicleId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "VehicleCompartment_vehicleId_name_key" ON "VehicleCompartment"("vehicleId", "name");

-- CreateIndex
CREATE INDEX "InspectionResponsible_userId_idx" ON "InspectionResponsible"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "InspectionResponsible_inspectionId_userId_key" ON "InspectionResponsible"("inspectionId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Vehicle_unitNumber_key" ON "Vehicle"("unitNumber");

-- CreateIndex
CREATE INDEX "VehicleInventoryItem_compartmentId_idx" ON "VehicleInventoryItem"("compartmentId");

-- AddForeignKey
ALTER TABLE "VehicleCompartment" ADD CONSTRAINT "VehicleCompartment_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleInventoryItem" ADD CONSTRAINT "VehicleInventoryItem_compartmentId_fkey" FOREIGN KEY ("compartmentId") REFERENCES "VehicleCompartment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InspectionResponsible" ADD CONSTRAINT "InspectionResponsible_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "Inspection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InspectionResponsible" ADD CONSTRAINT "InspectionResponsible_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
