-- Encuestas en Comunicaciones: la pregunta es el texto del mensaje; opciones y votos aparte.
CREATE TABLE "ChatPoll" (
  "id" TEXT NOT NULL,
  "messageId" TEXT NOT NULL,
  "allowMultiple" BOOLEAN NOT NULL DEFAULT false,
  "closedAt" TIMESTAMP(3),
  "closedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChatPoll_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ChatPoll_messageId_key" ON "ChatPoll"("messageId");
ALTER TABLE "ChatPoll" ADD CONSTRAINT "ChatPoll_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "ChatMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChatPoll" ADD CONSTRAINT "ChatPoll_closedByUserId_fkey" FOREIGN KEY ("closedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "ChatPollOption" (
  "id" TEXT NOT NULL,
  "pollId" TEXT NOT NULL,
  "text" VARCHAR(120) NOT NULL,
  "position" INTEGER NOT NULL,
  CONSTRAINT "ChatPollOption_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ChatPollOption_pollId_position_key" ON "ChatPollOption"("pollId", "position");
ALTER TABLE "ChatPollOption" ADD CONSTRAINT "ChatPollOption_pollId_fkey" FOREIGN KEY ("pollId") REFERENCES "ChatPoll"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ChatPollVote" (
  "pollId" TEXT NOT NULL,
  "optionId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "votedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChatPollVote_pkey" PRIMARY KEY ("optionId", "userId")
);
CREATE INDEX "ChatPollVote_pollId_userId_idx" ON "ChatPollVote"("pollId", "userId");
ALTER TABLE "ChatPollVote" ADD CONSTRAINT "ChatPollVote_pollId_fkey" FOREIGN KEY ("pollId") REFERENCES "ChatPoll"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChatPollVote" ADD CONSTRAINT "ChatPollVote_optionId_fkey" FOREIGN KEY ("optionId") REFERENCES "ChatPollOption"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChatPollVote" ADD CONSTRAINT "ChatPollVote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
