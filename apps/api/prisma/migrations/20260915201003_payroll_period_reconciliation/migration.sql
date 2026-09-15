-- AlterTable
ALTER TABLE "ProcessingPeriod" ADD COLUMN     "reconciledAt" TIMESTAMP(3),
ADD COLUMN     "reconciledBy" TEXT,
ADD COLUMN     "reconciliationNote" TEXT;
