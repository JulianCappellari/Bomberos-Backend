-- Como se cerro cada permanencia (QR o a distancia), para el control de cierres sin QR.
ALTER TABLE "Attendance" ADD COLUMN "checkOutMethod" VARCHAR(20);
UPDATE "Attendance" SET "checkOutMethod" = 'QR' WHERE "status" = 'CLOSED' AND "checkOutQrId" IS NOT NULL;
