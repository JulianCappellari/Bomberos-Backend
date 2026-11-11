-- 14: antiguedad en el cargo
ALTER TABLE "FirefighterProfile" ADD COLUMN "rankSince" TIMESTAMP(3);

-- 16: bolsa de reemplazos de guardia (oferta abierta sin destinatario hasta que alguien la toma)
ALTER TABLE "ShiftSwapRequest" ALTER COLUMN "toUserId" DROP NOT NULL;
ALTER TABLE "ShiftSwapRequest" ADD COLUMN "isOpenOffer" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "ShiftSwapRequest_isOpenOffer_status_idx" ON "ShiftSwapRequest"("isOpenOffer", "status");

-- 25: destinatarios de cada mensaje
ALTER TABLE "ChatMessage" ADD COLUMN "audience" VARCHAR(16) NOT NULL DEFAULT 'ALL';
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_audience_check" CHECK ("audience" IN ('ALL', 'COMMAND', 'DRIVERS', 'GUARD', 'BOARD'));

-- 27: agenda del cuartel
CREATE TABLE "StationEvent" (
  "id" TEXT NOT NULL,
  "title" VARCHAR(160) NOT NULL,
  "description" VARCHAR(4000) NOT NULL DEFAULT '',
  "kind" VARCHAR(16) NOT NULL,
  "location" VARCHAR(200) NOT NULL DEFAULT '',
  "startsAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3) NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "cancelledAt" TIMESTAMP(3),
  "cancelReason" VARCHAR(1000),
  "reminderSentAt" TIMESTAMP(3),
  "revision" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StationEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "StationEvent_kind_check" CHECK ("kind" IN ('TRAINING', 'MEETING', 'EVENT', 'OTHER')),
  CONSTRAINT "StationEvent_range_check" CHECK ("endsAt" > "startsAt"),
  CONSTRAINT "StationEvent_cancel_pair" CHECK (("cancelledAt" IS NULL) = ("cancelReason" IS NULL))
);
CREATE INDEX "StationEvent_startsAt_idx" ON "StationEvent"("startsAt");
ALTER TABLE "StationEvent" ADD CONSTRAINT "StationEvent_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "StationEventRsvp" (
  "eventId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "response" VARCHAR(12) NOT NULL,
  "respondedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StationEventRsvp_pkey" PRIMARY KEY ("eventId", "userId"),
  CONSTRAINT "StationEventRsvp_response_check" CHECK ("response" IN ('GOING', 'NOT_GOING', 'MAYBE'))
);
CREATE INDEX "StationEventRsvp_userId_idx" ON "StationEventRsvp"("userId");
ALTER TABLE "StationEventRsvp" ADD CONSTRAINT "StationEventRsvp_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "StationEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StationEventRsvp" ADD CONSTRAINT "StationEventRsvp_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 30: lecturas de documentos por version
CREATE TABLE "DocumentRead" (
  "documentId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DocumentRead_pkey" PRIMARY KEY ("documentId", "userId", "revision")
);
CREATE INDEX "DocumentRead_userId_idx" ON "DocumentRead"("userId");
ALTER TABLE "DocumentRead" ADD CONSTRAINT "DocumentRead_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "OperationalDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DocumentRead" ADD CONSTRAINT "DocumentRead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 14: reglas de ascenso
CREATE TABLE "PromotionRule" (
  "rank" VARCHAR(80) NOT NULL,
  "nextRank" VARCHAR(80) NOT NULL,
  "minYearsInRank" INTEGER NOT NULL DEFAULT 0,
  "minYearsService" INTEGER NOT NULL DEFAULT 0,
  "minApprovedCourses" INTEGER NOT NULL DEFAULT 0,
  "updatedByUserId" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PromotionRule_pkey" PRIMARY KEY ("rank"),
  CONSTRAINT "PromotionRule_values_check" CHECK ("minYearsInRank" >= 0 AND "minYearsService" >= 0 AND "minApprovedCourses" >= 0)
);
-- Valores iniciales orientativos; jefatura los ajusta desde la aplicacion.
INSERT INTO "PromotionRule" ("rank", "nextRank", "minYearsInRank", "minYearsService", "minApprovedCourses", "updatedAt") VALUES
  ('Aspirante menor', 'Aspirante mayor', 1, 1, 0, CURRENT_TIMESTAMP),
  ('Aspirante mayor', 'Bombero', 1, 2, 1, CURRENT_TIMESTAMP),
  ('Aspirante', 'Bombero', 1, 1, 1, CURRENT_TIMESTAMP),
  ('Bombero', 'Sub oficial', 5, 5, 3, CURRENT_TIMESTAMP),
  ('Sub oficial', 'Oficial', 4, 10, 5, CURRENT_TIMESTAMP);
