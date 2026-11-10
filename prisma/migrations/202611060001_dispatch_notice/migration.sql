CREATE TABLE "DispatchNotice" (
    "id" TEXT PRIMARY KEY,
    "source" VARCHAR(120) NOT NULL,
    "phone" VARCHAR(40),
    "location" VARCHAR(180) NOT NULL,
    "type" "AlertType" NOT NULL,
    "priority" "AlertPriority" NOT NULL,
    "notes" VARCHAR(2000) NOT NULL,
    "referral" VARCHAR(180),
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "operatorId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    "alertId" TEXT REFERENCES "Alert"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "DispatchNotice_alertId_key" ON "DispatchNotice"("alertId");
CREATE INDEX "DispatchNotice_receivedAt_idx" ON "DispatchNotice"("receivedAt");
