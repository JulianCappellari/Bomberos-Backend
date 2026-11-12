-- Informe publico: moviles que salieron, cantidad de personas que fueron y otras instituciones que participaron.
ALTER TABLE "PublicPost" ADD COLUMN "units" TEXT[] DEFAULT ARRAY[]::TEXT[], ADD COLUMN "peopleCount" INTEGER, ADD COLUMN "agencies" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "PublicPost" ADD CONSTRAINT "PublicPost_peopleCount_check" CHECK ("peopleCount" IS NULL OR ("peopleCount" >= 0 AND "peopleCount" <= 500));
