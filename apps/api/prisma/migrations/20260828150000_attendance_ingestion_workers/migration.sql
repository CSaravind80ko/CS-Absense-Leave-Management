-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "EventLedgerStatus" AS ENUM ('PROCESSING', 'COMPLETED', 'FAILED');

-- AlterEnum
ALTER TYPE "ExceptionType" ADD VALUE 'UNKNOWN_EMPLOYEE';
ALTER TYPE "ExceptionType" ADD VALUE 'INACTIVE_EMPLOYEE';
ALTER TYPE "ExceptionType" ADD VALUE 'OUT_OF_PERIOD';

-- AlterTable
ALTER TABLE "AttendanceImportJob"
ADD COLUMN "acceptedRows" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "rejectedRows" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "punchesUpserted" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "attendanceDaysUpdated" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "exceptionsOpened" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "errorCode" TEXT;

-- AlterTable
ALTER TABLE "AttendanceImportRow"
ADD COLUMN "canonicalData" JSONB,
ADD COLUMN "errorCode" TEXT;

-- DropForeignKey
ALTER TABLE "AttendanceException" DROP CONSTRAINT "AttendanceException_employeeId_tenantId_fkey";

-- AlterTable
ALTER TABLE "AttendanceException"
ALTER COLUMN "employeeId" DROP NOT NULL,
ADD COLUMN "importJobId" UUID,
ADD COLUMN "dedupeKey" TEXT;

-- AlterTable
ALTER TABLE "PayrollExport"
ADD COLUMN "storageBucket" TEXT,
ADD COLUMN "sizeBytes" BIGINT,
ADD COLUMN "errorCode" TEXT;

-- CreateTable
CREATE TABLE "AttendanceImportUpload" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "importJobId" UUID NOT NULL,
    "fileName" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "checksumSha256" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "finalizedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AttendanceImportUpload_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboxEvent" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "aggregateType" TEXT NOT NULL,
    "aggregateId" UUID NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventLedger" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "eventType" TEXT NOT NULL,
    "status" "EventLedgerStatus" NOT NULL DEFAULT 'PROCESSING',
    "attemptCount" INTEGER NOT NULL DEFAULT 1,
    "lockedUntil" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EventLedger_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceImportUpload_importJobId_tenantId_key" ON "AttendanceImportUpload"("importJobId", "tenantId");
CREATE UNIQUE INDEX "AttendanceImportUpload_tenantId_storageKey_key" ON "AttendanceImportUpload"("tenantId", "storageKey");
CREATE UNIQUE INDEX "AttendanceImportUpload_id_tenantId_key" ON "AttendanceImportUpload"("id", "tenantId");
CREATE INDEX "AttendanceImportUpload_tenantId_expiresAt_idx" ON "AttendanceImportUpload"("tenantId", "expiresAt");
CREATE UNIQUE INDEX "AttendanceImportFile_tenantId_importJobId_key" ON "AttendanceImportFile"("tenantId", "importJobId");
CREATE UNIQUE INDEX "AttendanceException_tenantId_dedupeKey_key" ON "AttendanceException"("tenantId", "dedupeKey");
CREATE UNIQUE INDEX "OutboxEvent_eventId_key" ON "OutboxEvent"("eventId");
CREATE INDEX "OutboxEvent_status_availableAt_createdAt_idx" ON "OutboxEvent"("status", "availableAt", "createdAt");
CREATE INDEX "OutboxEvent_tenantId_aggregateType_aggregateId_idx" ON "OutboxEvent"("tenantId", "aggregateType", "aggregateId");
CREATE UNIQUE INDEX "EventLedger_eventId_key" ON "EventLedger"("eventId");
CREATE INDEX "EventLedger_status_lockedUntil_idx" ON "EventLedger"("status", "lockedUntil");
CREATE INDEX "EventLedger_tenantId_eventType_createdAt_idx" ON "EventLedger"("tenantId", "eventType", "createdAt");

-- AddForeignKey
ALTER TABLE "AttendanceImportUpload" ADD CONSTRAINT "AttendanceImportUpload_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AttendanceImportUpload" ADD CONSTRAINT "AttendanceImportUpload_importJobId_tenantId_fkey" FOREIGN KEY ("importJobId", "tenantId") REFERENCES "AttendanceImportJob"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AttendanceException" ADD CONSTRAINT "AttendanceException_employeeId_tenantId_fkey" FOREIGN KEY ("employeeId", "tenantId") REFERENCES "Employee"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AttendanceException" ADD CONSTRAINT "AttendanceException_importJobId_tenantId_fkey" FOREIGN KEY ("importJobId", "tenantId") REFERENCES "AttendanceImportJob"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OutboxEvent" ADD CONSTRAINT "OutboxEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EventLedger" ADD CONSTRAINT "EventLedger_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
