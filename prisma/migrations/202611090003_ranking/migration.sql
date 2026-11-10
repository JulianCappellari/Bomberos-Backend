ALTER TABLE "WorkTask" ADD COLUMN "rankingRecoveryKey" VARCHAR(160);
CREATE UNIQUE INDEX "WorkTask_rankingRecoveryKey_key" ON "WorkTask"("rankingRecoveryKey");
CREATE TABLE "RankingPolicy" ("id" TEXT NOT NULL DEFAULT 'main', "revision" INTEGER NOT NULL DEFAULT 1, "config" JSONB NOT NULL, "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "RankingPolicy_pkey" PRIMARY KEY ("id"));
CREATE TABLE "RankingTemplate" ("id" TEXT NOT NULL, "title" VARCHAR(160) NOT NULL, "description" VARCHAR(4000) NOT NULL, "active" BOOLEAN NOT NULL DEFAULT true, "revision" INTEGER NOT NULL DEFAULT 1, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "RankingTemplate_pkey" PRIMARY KEY ("id"));
