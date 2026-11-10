CREATE TABLE "MemberNotification" (
 "id" TEXT PRIMARY KEY, "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "title" VARCHAR(160) NOT NULL, "href" VARCHAR(200) NOT NULL, "readAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "MemberNotification_userId_readAt_createdAt_idx" ON "MemberNotification"("userId","readAt","createdAt");
