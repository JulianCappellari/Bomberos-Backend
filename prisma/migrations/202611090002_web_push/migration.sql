ALTER TABLE "MemberNotification" ADD COLUMN "pushQueuedAt" TIMESTAMP(3);
CREATE INDEX "MemberNotification_pushQueuedAt_createdAt_idx" ON "MemberNotification"("pushQueuedAt", "createdAt");
CREATE TABLE "PushSubscription" (
  "id" TEXT NOT NULL, "userId" TEXT NOT NULL, "sessionId" TEXT NOT NULL,
  "endpointHash" VARCHAR(64) NOT NULL, "endpoint" VARCHAR(2048) NOT NULL,
  "p256dh" VARCHAR(100) NOT NULL, "auth" VARCHAR(50) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PushSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PushSubscription_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AuthSession"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PushSubscription_endpointHash_key" ON "PushSubscription"("endpointHash");
CREATE INDEX "PushSubscription_userId_sessionId_idx" ON "PushSubscription"("userId", "sessionId");
CREATE TABLE "PushDelivery" (
  "id" TEXT NOT NULL, "notificationId" TEXT NOT NULL, "subscriptionId" TEXT NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0, "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leaseUntil" TIMESTAMP(3), "finishedAt" TIMESTAMP(3), "deliveredAt" TIMESTAMP(3),
  "errorCode" VARCHAR(40), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PushDelivery_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PushDelivery_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "MemberNotification"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PushDelivery_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "PushSubscription"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PushDelivery_notificationId_subscriptionId_key" ON "PushDelivery"("notificationId", "subscriptionId");
CREATE INDEX "PushDelivery_finishedAt_nextAttemptAt_leaseUntil_idx" ON "PushDelivery"("finishedAt", "nextAttemptAt", "leaseUntil");
