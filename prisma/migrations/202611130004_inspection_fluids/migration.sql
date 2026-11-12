-- Fluidos del movil registrados en cada control vehicular y tipo de combustible de la unidad.
ALTER TABLE "Inspection" ADD COLUMN "oilLevel" VARCHAR(20), ADD COLUMN "coolantLevel" VARCHAR(20), ADD COLUMN "fuelLevel" VARCHAR(20);
ALTER TABLE "Inspection" ADD CONSTRAINT "Inspection_oilLevel_check" CHECK ("oilLevel" IS NULL OR "oilLevel" IN ('OK','LOW','ADDED'));
ALTER TABLE "Inspection" ADD CONSTRAINT "Inspection_coolantLevel_check" CHECK ("coolantLevel" IS NULL OR "coolantLevel" IN ('OK','LOW','ADDED'));
ALTER TABLE "Inspection" ADD CONSTRAINT "Inspection_fuelLevel_check" CHECK ("fuelLevel" IS NULL OR "fuelLevel" IN ('FULL','THREE_QUARTERS','HALF','QUARTER','RESERVE'));
ALTER TABLE "Vehicle" ADD COLUMN "fuelType" VARCHAR(60);
