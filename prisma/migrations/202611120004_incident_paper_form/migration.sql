-- Constancia de intervencion: datos del formulario en papel.
ALTER TABLE "IncidentSheet" ADD COLUMN "addressNumber" VARCHAR(40) NOT NULL DEFAULT '';
ALTER TABLE "IncidentSheet" ADD COLUMN "receivedBy" VARCHAR(120) NOT NULL DEFAULT '';
ALTER TABLE "IncidentSheet" ADD COLUMN "firefightersOnScene" VARCHAR(1000) NOT NULL DEFAULT '';
ALTER TABLE "IncidentSheet" ADD COLUMN "classifications" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "IncidentSheet" ADD COLUMN "classificationDetail" VARCHAR(300) NOT NULL DEFAULT '';

-- Pedido de auxilio N°: correlativo por año (hora de Argentina).
ALTER TABLE "Incident" ADD COLUMN "requestYear" INTEGER;
ALTER TABLE "Incident" ADD COLUMN "requestNumber" INTEGER;

-- Numeracion de lo existente por orden de ocurrencia; una intervencion rehecha conserva el numero de la anulada.
WITH numbered AS (
  SELECT "id",
         EXTRACT(YEAR FROM ("occurredAt" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Argentina/Buenos_Aires')::int AS y,
         ROW_NUMBER() OVER (PARTITION BY EXTRACT(YEAR FROM ("occurredAt" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Argentina/Buenos_Aires') ORDER BY "occurredAt", "createdAt", "id") AS n
  FROM "Incident" WHERE "replacesIncidentId" IS NULL
)
UPDATE "Incident" i SET "requestYear" = numbered.y, "requestNumber" = numbered.n FROM numbered WHERE numbered."id" = i."id";
DO $$ BEGIN
  FOR step IN 1..10 LOOP
    UPDATE "Incident" i SET "requestYear" = r."requestYear", "requestNumber" = r."requestNumber"
    FROM "Incident" r WHERE i."replacesIncidentId" = r."id" AND i."requestNumber" IS NULL AND r."requestNumber" IS NOT NULL;
  END LOOP;
END $$;

-- Unico entre las vigentes: la anulada y su reemplazo comparten numero.
CREATE UNIQUE INDEX "Incident_request_number_active_key" ON "Incident"("requestYear", "requestNumber") WHERE "voidedAt" IS NULL;

CREATE OR REPLACE FUNCTION incident_request_number() RETURNS trigger AS $fn$
DECLARE next_number integer;
BEGIN
  IF NEW."requestYear" IS NULL THEN
    NEW."requestYear" := EXTRACT(YEAR FROM (NEW."occurredAt" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Argentina/Buenos_Aires')::int;
  END IF;
  IF NEW."requestNumber" IS NULL THEN
    -- Dos alertas simultaneas no pueden tomar el mismo numero.
    PERFORM pg_advisory_xact_lock(hashtext(TG_TABLE_SCHEMA || '.incident-request-number.' || NEW."requestYear"));
    EXECUTE format('SELECT COALESCE(MAX("requestNumber"), 0) + 1 FROM %I.%I WHERE "requestYear" = $1', TG_TABLE_SCHEMA, TG_TABLE_NAME) INTO next_number USING NEW."requestYear";
    NEW."requestNumber" := next_number;
  END IF;
  RETURN NEW;
END
$fn$ LANGUAGE plpgsql;
CREATE TRIGGER incident_request_number BEFORE INSERT ON "Incident" FOR EACH ROW EXECUTE FUNCTION incident_request_number();
