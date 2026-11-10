ALTER TABLE "MemberNotification" ADD COLUMN "dedupeKey" VARCHAR(200);
CREATE UNIQUE INDEX "MemberNotification_dedupeKey_key" ON "MemberNotification"("dedupeKey");
CREATE TABLE "ControlGroup" (
 "id" TEXT PRIMARY KEY, "name" VARCHAR(100) NOT NULL, "startsOn" DATE NOT NULL,
 "repeatWeeks" INTEGER NOT NULL DEFAULT 4 CHECK ("repeatWeeks" BETWEEN 1 AND 52), "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" > 0)
);
CREATE TABLE "ControlGroupMember" (
 "groupId" TEXT NOT NULL REFERENCES "ControlGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 PRIMARY KEY ("groupId","userId")
);
CREATE UNIQUE INDEX "ControlGroupMember_userId_key" ON "ControlGroupMember"("userId");
