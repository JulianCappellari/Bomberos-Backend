-- Buzon de sugerencias (anonimo opcional), sanciones y novedades publicas.
CREATE TABLE "Feedback" (
  "id" TEXT NOT NULL, "kind" VARCHAR(20) NOT NULL, "title" VARCHAR(160) NOT NULL, "body" VARCHAR(4000) NOT NULL,
  "anonymous" BOOLEAN NOT NULL, "authorUserId" TEXT, "ownerKey" VARCHAR(64) NOT NULL, "receivedOn" DATE NOT NULL,
  "sentAt" TIMESTAMP(3), "readAt" TIMESTAMP(3), "readByUserId" TEXT,
  CONSTRAINT "Feedback_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Feedback_kind_check" CHECK ("kind" IN ('COMPLAINT','SUGGESTION','IDEA','OPINION','IMPROVEMENT')),
  -- Un envio anonimo no puede guardar autor ni hora exacta.
  CONSTRAINT "Feedback_anonymous_check" CHECK (NOT "anonymous" OR ("authorUserId" IS NULL AND "sentAt" IS NULL)),
  CONSTRAINT "Feedback_named_check" CHECK ("anonymous" OR "authorUserId" IS NOT NULL)
);
CREATE INDEX "Feedback_ownerKey_idx" ON "Feedback"("ownerKey");
CREATE INDEX "Feedback_readAt_receivedOn_idx" ON "Feedback"("readAt", "receivedOn");

CREATE TABLE "Sanction" (
  "id" TEXT NOT NULL, "userId" TEXT NOT NULL, "kind" VARCHAR(20) NOT NULL, "reason" VARCHAR(2000) NOT NULL,
  "startsOn" DATE NOT NULL, "endsOn" DATE, "points" INTEGER NOT NULL DEFAULT 0, "restrictions" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "issuedByUserId" TEXT NOT NULL, "revokedAt" TIMESTAMP(3), "revokedByUserId" TEXT, "revokeReason" VARCHAR(1000),
  "revision" INTEGER NOT NULL DEFAULT 1, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Sanction_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Sanction_kind_check" CHECK ("kind" IN ('WARNING','REPRIMAND','SUSPENSION','OTHER')),
  CONSTRAINT "Sanction_points_check" CHECK ("points" >= 0 AND "points" <= 1000),
  CONSTRAINT "Sanction_dates_check" CHECK ("endsOn" IS NULL OR "endsOn" >= "startsOn"),
  CONSTRAINT "Sanction_user_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Sanction_issuer_fkey" FOREIGN KEY ("issuedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "Sanction_userId_startsOn_idx" ON "Sanction"("userId", "startsOn");

CREATE TABLE "PublicPost" (
  "id" TEXT NOT NULL, "kind" VARCHAR(20) NOT NULL, "title" VARCHAR(160) NOT NULL, "summary" VARCHAR(400) NOT NULL, "body" TEXT NOT NULL,
  "incidentId" TEXT, "happenedOn" DATE, "status" VARCHAR(12) NOT NULL DEFAULT 'DRAFT', "publishedAt" TIMESTAMP(3),
  "authorUserId" TEXT NOT NULL, "revision" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PublicPost_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PublicPost_kind_check" CHECK ("kind" IN ('INCIDENT','TRAINING','NEWS')),
  CONSTRAINT "PublicPost_status_check" CHECK ("status" IN ('DRAFT','PUBLISHED','ARCHIVED'))
);
CREATE INDEX "PublicPost_status_publishedAt_idx" ON "PublicPost"("status", "publishedAt");

CREATE TABLE "PublicPostPhoto" (
  "id" TEXT NOT NULL, "postId" TEXT NOT NULL, "bytes" BYTEA NOT NULL, "sha256" VARCHAR(64) NOT NULL, "position" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PublicPostPhoto_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PublicPostPhoto_postId_fkey" FOREIGN KEY ("postId") REFERENCES "PublicPost"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "PublicPostPhoto_postId_position_idx" ON "PublicPostPhoto"("postId", "position");
