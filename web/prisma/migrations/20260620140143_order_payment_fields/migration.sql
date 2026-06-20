-- AlterTable
ALTER TABLE "Order" ADD COLUMN "paidAt" DATETIME;
ALTER TABLE "Order" ADD COLUMN "paymentKey" TEXT;
ALTER TABLE "Order" ADD COLUMN "paymentMethod" TEXT;
ALTER TABLE "Order" ADD COLUMN "pgProvider" TEXT;
