-- CreateEnum
CREATE TYPE "AttendanceSourceType" AS ENUM ('ESSL_BIOMETRIC', 'GREYTHR', 'SFTP', 'MANUAL_FILE');

-- CreateEnum
CREATE TYPE "AttendanceSourceConnectionStatus" AS ENUM ('DRAFT', 'READY', 'ACTIVE', 'DISABLED');

-- CreateTable
CREATE TABLE "AttendanceSourceConnection" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "type" "AttendanceSourceType" NOT NULL,
    "name" TEXT NOT NULL,
    "status" "AttendanceSourceConnectionStatus" NOT NULL DEFAULT 'DRAFT',
    "config" JSONB,
    "credentialReference" TEXT,
    "lastSyncAt" TIMESTAMP(3),
    "lastSyncStatus" TEXT,
    "lastSyncRecordCount" INTEGER,
    "activatedAt" TIMESTAMP(3),
    "disabledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttendanceSourceConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceSourceSyncLog" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "connectionId" UUID NOT NULL,
    "status" TEXT NOT NULL,
    "recordCount" INTEGER,
    "note" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recordedBy" TEXT NOT NULL,

    CONSTRAINT "AttendanceSourceSyncLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AttendanceSourceConnection_tenantId_status_idx" ON "AttendanceSourceConnection"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceSourceConnection_id_tenantId_key" ON "AttendanceSourceConnection"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceSourceConnection_tenantId_name_key" ON "AttendanceSourceConnection"("tenantId", "name");

-- CreateIndex
CREATE INDEX "AttendanceSourceSyncLog_tenantId_connectionId_occurredAt_idx" ON "AttendanceSourceSyncLog"("tenantId", "connectionId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceSourceSyncLog_id_tenantId_key" ON "AttendanceSourceSyncLog"("id", "tenantId");

-- AddForeignKey
ALTER TABLE "AttendanceSourceConnection" ADD CONSTRAINT "AttendanceSourceConnection_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceSourceSyncLog" ADD CONSTRAINT "AttendanceSourceSyncLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceSourceSyncLog" ADD CONSTRAINT "AttendanceSourceSyncLog_connectionId_tenantId_fkey" FOREIGN KEY ("connectionId", "tenantId") REFERENCES "AttendanceSourceConnection"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
