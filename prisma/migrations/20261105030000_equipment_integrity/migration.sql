ALTER TABLE "PersonalEquipmentIssue" DROP CONSTRAINT "PersonalEquipmentIssue_return_consistent";
ALTER TABLE "PersonalEquipmentIssue" ADD CONSTRAINT "PersonalEquipmentIssue_return_consistent"
  CHECK (("returnedAt" IS NULL AND "receivedByUserId" IS NULL AND "returnCondition" IS NULL)
    OR ("returnedAt" IS NOT NULL AND "returnedAt" >= "issuedAt" AND "receivedByUserId" IS NOT NULL AND "returnCondition" IS NOT NULL));
ALTER TABLE "PersonalEquipmentRequest" ADD CONSTRAINT "PersonalEquipmentRequest_review_identity_time"
  CHECK ("reviewedAt" IS NULL OR ("reviewedAt" >= "createdAt" AND "reviewedByUserId" IS NOT NULL AND "reviewedByUserId" <> "userId"));
ALTER TABLE "PersonalEquipmentRequest" ADD CONSTRAINT "PersonalEquipmentRequest_fulfillment_time"
  CHECK ("status" <> 'FULFILLED' OR ("fulfilledAt" >= "reviewedAt" AND "fulfilledAt" >= "createdAt"));
