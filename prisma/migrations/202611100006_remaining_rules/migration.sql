-- G15: una intervencion cerrada no se edita; se anula y se rehace en una nueva que la reemplaza.
ALTER TABLE "Incident" ADD COLUMN "voidedAt" TIMESTAMP(3), ADD COLUMN "voidReason" VARCHAR(2000), ADD COLUMN "replacesIncidentId" TEXT;
CREATE UNIQUE INDEX "Incident_replacesIncidentId_key" ON "Incident"("replacesIncidentId");
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_replacesIncidentId_fkey" FOREIGN KEY ("replacesIncidentId") REFERENCES "Incident"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_void_pair" CHECK (("voidedAt" IS NULL) = ("voidReason" IS NULL));

-- P04: la entrega de una prenda requiere la aceptacion de su titular.
ALTER TABLE "PersonalEquipmentIssue" ADD COLUMN "holderAcceptedAt" TIMESTAMP(3);
-- Las entregas anteriores a esta regla se consideran aceptadas en su fecha de entrega.
UPDATE "PersonalEquipmentIssue" SET "holderAcceptedAt" = "issuedAt";
