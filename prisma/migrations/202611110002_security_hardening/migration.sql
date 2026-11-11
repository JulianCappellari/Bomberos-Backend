-- Bloqueo de cuenta por intentos fallidos (independiente de la IP: frena la adivinacion distribuida).
ALTER TABLE "User" ADD COLUMN "failedLoginCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "lockedUntil" TIMESTAMP(3);

-- Auditoria inalterable: no se modifica ni se borra un registro desde la aplicacion.
-- Unica excepcion automatica: desvincular al autor cuando se elimina su usuario (ON DELETE SET NULL).
-- La purga explicita (retencion o limpieza de pruebas) exige activar "bomberos.audit_purge" en la transaccion.
CREATE OR REPLACE FUNCTION "audit_log_protect"() RETURNS trigger AS $$
BEGIN
  IF current_setting('bomberos.audit_purge', true) = 'on' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP = 'UPDATE'
     AND NEW."actorUserId" IS NULL AND OLD."actorUserId" IS NOT NULL
     AND NEW."id" = OLD."id" AND NEW."action" = OLD."action" AND NEW."entityType" = OLD."entityType"
     AND NEW."entityId" = OLD."entityId" AND NEW."createdAt" = OLD."createdAt"
     AND NEW."metadata" IS NOT DISTINCT FROM OLD."metadata" THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'La auditoria es inalterable: no se puede modificar ni borrar un registro' USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "audit_log_append_only"
  BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION "audit_log_protect"();

-- TRUNCATE no dispara triggers por fila: se bloquea aparte.
CREATE OR REPLACE FUNCTION "audit_log_no_truncate"() RETURNS trigger AS $$
BEGIN
  IF current_setting('bomberos.audit_purge', true) = 'on' THEN RETURN NULL; END IF;
  RAISE EXCEPTION 'La auditoria es inalterable: no se puede vaciar' USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "audit_log_no_truncate"
  BEFORE TRUNCATE ON "AuditLog"
  FOR EACH STATEMENT EXECUTE FUNCTION "audit_log_no_truncate"();
