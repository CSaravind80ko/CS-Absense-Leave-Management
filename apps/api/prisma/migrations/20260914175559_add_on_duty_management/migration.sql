-- CreateEnum
CREATE TYPE "OnDutyRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "OnDutyCategory" AS ENUM ('CLIENT_VISIT', 'GOVERNMENT_OFFICE', 'TRAINING', 'CONFERENCE', 'OTHER');

-- AlterEnum
ALTER TYPE "ApprovalType" ADD VALUE 'ON_DUTY';

-- AlterEnum
ALTER TYPE "AttendanceStatus" ADD VALUE 'ON_DUTY';

-- AlterTable
ALTER TABLE "ApprovalRequest" ADD COLUMN     "onDutyRequestId" UUID;

-- CreateTable
CREATE TABLE "OnDutyRequest" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "category" "OnDutyCategory" NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "halfDay" BOOLEAN NOT NULL DEFAULT false,
    "totalDays" DECIMAL(5,2) NOT NULL,
    "location" TEXT,
    "reason" TEXT NOT NULL,
    "status" "OnDutyRequestStatus" NOT NULL DEFAULT 'PENDING',
    "version" INTEGER NOT NULL DEFAULT 1,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OnDutyRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OnDutyRequest_tenantId_employeeId_status_idx" ON "OnDutyRequest"("tenantId", "employeeId", "status");

-- CreateIndex
CREATE INDEX "OnDutyRequest_tenantId_status_idx" ON "OnDutyRequest"("tenantId", "status");

-- CreateIndex
CREATE INDEX "OnDutyRequest_tenantId_employeeId_startDate_endDate_idx" ON "OnDutyRequest"("tenantId", "employeeId", "startDate", "endDate");

-- CreateIndex
CREATE UNIQUE INDEX "OnDutyRequest_id_tenantId_key" ON "OnDutyRequest"("id", "tenantId");

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_onDutyRequestId_tenantId_fkey" FOREIGN KEY ("onDutyRequestId", "tenantId") REFERENCES "OnDutyRequest"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnDutyRequest" ADD CONSTRAINT "OnDutyRequest_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnDutyRequest" ADD CONSTRAINT "OnDutyRequest_employeeId_tenantId_fkey" FOREIGN KEY ("employeeId", "tenantId") REFERENCES "Employee"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
