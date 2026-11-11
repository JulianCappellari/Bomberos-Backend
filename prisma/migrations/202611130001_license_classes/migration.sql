-- Licencias: datos por clase y categoria de licencia de cada movil.
ALTER TABLE "PersonalDeclaration" ADD COLUMN "licenseClassDetails" JSONB;
ALTER TABLE "Vehicle" ADD COLUMN "licenseCategory" VARCHAR(20) NOT NULL DEFAULT 'UNSET';

-- Clases a la forma oficial: "B1" -> "B.1", "a11" -> "A.1.1".
CREATE OR REPLACE FUNCTION pg_temp.license_class(c text) RETURNS text AS $fn$
  SELECT CASE
    WHEN upper(replace(c, ' ', '')) ~ '^[A-G]\.?[0-9]\.?[0-9]$' THEN regexp_replace(upper(replace(c, ' ', '')), '^([A-G])\.?([0-9])\.?([0-9])$', '\1.\2.\3')
    WHEN upper(replace(c, ' ', '')) ~ '^[A-G]\.?[0-9]$' THEN regexp_replace(upper(replace(c, ' ', '')), '^([A-G])\.?([0-9])$', '\1.\2')
    ELSE upper(replace(c, ' ', ''))
  END
$fn$ LANGUAGE sql IMMUTABLE;
UPDATE "PersonalDeclaration" SET "licenseClasses" = ARRAY(SELECT pg_temp.license_class(c) FROM unnest("licenseClasses") AS c)
WHERE "category" = 'DRIVER_LICENSE' AND cardinality("licenseClasses") > 0;
UPDATE "VehicleDriverAuthorization" SET "requiredClass" = pg_temp.license_class("requiredClass");
