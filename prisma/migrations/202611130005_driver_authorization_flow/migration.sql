-- Habilitacion de conductores con pedido y decision de jefatura.
ALTER TABLE "VehicleDriverAuthorization"
  ADD COLUMN "status" VARCHAR(12) NOT NULL DEFAULT 'APPROVED',
  ADD COLUMN "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "decidedAt" TIMESTAMP(3),
  ADD COLUMN "decisionNote" VARCHAR(1000),
  ALTER COLUMN "grantedByUserId" DROP NOT NULL,
  ALTER COLUMN "reason" SET DEFAULT '';
ALTER TABLE "VehicleDriverAuthorization" ADD CONSTRAINT "VehicleDriverAuthorization_status_check" CHECK ("status" IN ('PENDING','APPROVED','REJECTED','REVOKED'));
-- Las habilitaciones existentes ya fueron dadas por jefatura; las revocadas (vencidas a mano) quedan como REVOKED.
UPDATE "VehicleDriverAuthorization" SET "decidedAt" = "requestedAt" WHERE "status" = 'APPROVED';
UPDATE "VehicleDriverAuthorization" SET "status" = 'REVOKED' WHERE "validUntil" < CURRENT_DATE;

-- Cada licencia es de UNA clase (cada clase tiene su propio numero y fechas). Las cargadas con varias clases
-- se separan en una licencia por clase, conservando numero, emisor y fechas de cada clase para que el titular las revise.
INSERT INTO "PersonalDeclaration" ("id","userId","category","title","details","licenseNumber","issuer","licenseClasses","licenseClassDetails","issuedOn","expiresOn","revision","createdAt","updatedAt")
SELECT 'lic' || substr(md5(d."id" || ':' || c.code), 1, 22), d."userId", d."category", 'Licencia ' || c.code,
       left(d."details" || ' · Separada de una licencia con varias clases: revisá que el número corresponda a esta clase.', 4000),
       d."licenseNumber", d."issuer", ARRAY[c.code],
       jsonb_build_array(coalesce(det.x, jsonb_build_object('code', c.code))),
       coalesce(nullif(det.x->>'grantedOn','')::date, d."issuedOn"), coalesce(nullif(det.x->>'expiresOn','')::date, d."expiresOn"),
       1, d."createdAt", CURRENT_TIMESTAMP
FROM "PersonalDeclaration" d
CROSS JOIN LATERAL unnest(d."licenseClasses"[2:cardinality(d."licenseClasses")]) AS c(code)
LEFT JOIN LATERAL (
  SELECT x FROM jsonb_array_elements(CASE WHEN jsonb_typeof(d."licenseClassDetails"::jsonb) = 'array' THEN d."licenseClassDetails"::jsonb ELSE '[]'::jsonb END) x
  WHERE x->>'code' = c.code LIMIT 1
) det ON true
WHERE d."category" = 'DRIVER_LICENSE' AND d."deletedAt" IS NULL AND cardinality(d."licenseClasses") > 1
ON CONFLICT ("id") DO NOTHING;

UPDATE "PersonalDeclaration" d SET
  "licenseClasses" = d."licenseClasses"[1:1],
  "licenseClassDetails" = coalesce((
    SELECT jsonb_agg(x) FROM jsonb_array_elements(CASE WHEN jsonb_typeof(d."licenseClassDetails"::jsonb) = 'array' THEN d."licenseClassDetails"::jsonb ELSE '[]'::jsonb END) x
    WHERE x->>'code' = d."licenseClasses"[1]), jsonb_build_array(jsonb_build_object('code', d."licenseClasses"[1]))),
  "title" = 'Licencia ' || d."licenseClasses"[1]
WHERE d."category" = 'DRIVER_LICENSE' AND d."deletedAt" IS NULL AND cardinality(d."licenseClasses") > 1;
