-- CreateEnum
CREATE TYPE "ExceptionSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "PayrollImpact" AS ENUM ('NONE', 'REVIEW_REQUIRED', 'UNPAID_MINUTES', 'BLOCKED');

-- DropForeignKey
ALTER TABLE "AttendanceImportJob" DROP CONSTRAINT "AttendanceImportJob_periodId_fkey";

-- DropForeignKey
ALTER TABLE "AttendanceImportFile" DROP CONSTRAINT "AttendanceImportFile_importJobId_fkey";

-- DropForeignKey
ALTER TABLE "AttendanceImportRow" DROP CONSTRAINT "AttendanceImportRow_fileId_fkey";

-- DropForeignKey
ALTER TABLE "AttendancePunch" DROP CONSTRAINT "AttendancePunch_employeeId_fkey";

-- DropForeignKey
ALTER TABLE "AttendancePunch" DROP CONSTRAINT "AttendancePunch_importRowId_fkey";

-- DropForeignKey
ALTER TABLE "AttendanceDay" DROP CONSTRAINT "AttendanceDay_periodId_fkey";

-- DropForeignKey
ALTER TABLE "AttendanceDay" DROP CONSTRAINT "AttendanceDay_employeeId_fkey";

-- DropForeignKey
ALTER TABLE "AttendanceException" DROP CONSTRAINT "AttendanceException_attendanceDayId_fkey";

-- DropForeignKey
ALTER TABLE "AttendanceException" DROP CONSTRAINT "AttendanceException_employeeId_fkey";

-- DropForeignKey
ALTER TABLE "ApprovalRequest" DROP CONSTRAINT "ApprovalRequest_periodId_fkey";

-- DropForeignKey
ALTER TABLE "ApprovalRequest" DROP CONSTRAINT "ApprovalRequest_exceptionId_fkey";

-- DropForeignKey
ALTER TABLE "ApprovalAction" DROP CONSTRAINT "ApprovalAction_approvalRequestId_fkey";

-- DropForeignKey
ALTER TABLE "PayrollExport" DROP CONSTRAINT "PayrollExport_periodId_fkey";

-- DropForeignKey
ALTER TABLE "PayrollExport" DROP CONSTRAINT "PayrollExport_approvalRequestId_fkey";

-- DropForeignKey
ALTER TABLE "PayrollExportItem" DROP CONSTRAINT "PayrollExportItem_payrollExportId_fkey";

-- DropForeignKey
ALTER TABLE "PayrollExportItem" DROP CONSTRAINT "PayrollExportItem_employeeId_fkey";

-- AlterTable
ALTER TABLE "ProcessingPeriod" ADD COLUMN     "reopenReason" TEXT,
ADD COLUMN     "reopenedAt" TIMESTAMP(3),
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "AttendanceDay" ADD COLUMN     "firstPunchAt" TIMESTAMP(3),
ADD COLUMN     "lastPunchAt" TIMESTAMP(3),
ADD COLUMN     "sourceSummary" JSONB,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "AttendanceException" ADD COLUMN     "assignedToRole" "ApplicationRole",
ADD COLUMN     "assignedToSubject" TEXT,
ADD COLUMN     "payrollImpact" "PayrollImpact" NOT NULL DEFAULT 'REVIEW_REQUIRED',
ADD COLUMN     "payrollImpactMinutes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "severity" "ExceptionSeverity" NOT NULL DEFAULT 'MEDIUM',
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "ApprovalRequest" ADD COLUMN     "assigneeRole" "ApplicationRole",
ADD COLUMN     "assigneeSubject" TEXT,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "PayrollExport" ADD COLUMN     "periodVersion" INTEGER,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

UPDATE "PayrollExport" AS export
SET "periodVersion" = period."version"
FROM "ProcessingPeriod" AS period
WHERE export."periodId" = period."id"
  AND export."tenantId" = period."tenantId";

ALTER TABLE "PayrollExport" ALTER COLUMN "periodVersion" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Employee_id_tenantId_key" ON "Employee"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "ProcessingPeriod_id_tenantId_key" ON "ProcessingPeriod"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceImportJob_id_tenantId_key" ON "AttendanceImportJob"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceImportFile_id_tenantId_key" ON "AttendanceImportFile"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceImportRow_id_tenantId_key" ON "AttendanceImportRow"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "AttendancePunch_id_tenantId_key" ON "AttendancePunch"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceDay_id_tenantId_key" ON "AttendanceDay"("id", "tenantId");

-- CreateIndex
CREATE INDEX "AttendanceException_tenantId_status_severity_payrollImpact_idx" ON "AttendanceException"("tenantId", "status", "severity", "payrollImpact");

-- CreateIndex
CREATE INDEX "AttendanceException_tenantId_assignedToSubject_status_idx" ON "AttendanceException"("tenantId", "assignedToSubject", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceException_id_tenantId_key" ON "AttendanceException"("id", "tenantId");

-- CreateIndex
CREATE INDEX "ApprovalRequest_tenantId_assigneeSubject_status_idx" ON "ApprovalRequest"("tenantId", "assigneeSubject", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalRequest_id_tenantId_key" ON "ApprovalRequest"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollExport_id_tenantId_key" ON "PayrollExport"("id", "tenantId");

-- AddForeignKey
ALTER TABLE "AttendanceImportJob" ADD CONSTRAINT "AttendanceImportJob_periodId_tenantId_fkey" FOREIGN KEY ("periodId", "tenantId") REFERENCES "ProcessingPeriod"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceImportFile" ADD CONSTRAINT "AttendanceImportFile_importJobId_tenantId_fkey" FOREIGN KEY ("importJobId", "tenantId") REFERENCES "AttendanceImportJob"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceImportRow" ADD CONSTRAINT "AttendanceImportRow_fileId_tenantId_fkey" FOREIGN KEY ("fileId", "tenantId") REFERENCES "AttendanceImportFile"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendancePunch" ADD CONSTRAINT "AttendancePunch_employeeId_tenantId_fkey" FOREIGN KEY ("employeeId", "tenantId") REFERENCES "Employee"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendancePunch" ADD CONSTRAINT "AttendancePunch_importRowId_tenantId_fkey" FOREIGN KEY ("importRowId", "tenantId") REFERENCES "AttendanceImportRow"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceDay" ADD CONSTRAINT "AttendanceDay_periodId_tenantId_fkey" FOREIGN KEY ("periodId", "tenantId") REFERENCES "ProcessingPeriod"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceDay" ADD CONSTRAINT "AttendanceDay_employeeId_tenantId_fkey" FOREIGN KEY ("employeeId", "tenantId") REFERENCES "Employee"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceException" ADD CONSTRAINT "AttendanceException_attendanceDayId_tenantId_fkey" FOREIGN KEY ("attendanceDayId", "tenantId") REFERENCES "AttendanceDay"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceException" ADD CONSTRAINT "AttendanceException_employeeId_tenantId_fkey" FOREIGN KEY ("employeeId", "tenantId") REFERENCES "Employee"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_periodId_tenantId_fkey" FOREIGN KEY ("periodId", "tenantId") REFERENCES "ProcessingPeriod"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_exceptionId_tenantId_fkey" FOREIGN KEY ("exceptionId", "tenantId") REFERENCES "AttendanceException"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalAction" ADD CONSTRAINT "ApprovalAction_approvalRequestId_tenantId_fkey" FOREIGN KEY ("approvalRequestId", "tenantId") REFERENCES "ApprovalRequest"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollExport" ADD CONSTRAINT "PayrollExport_periodId_tenantId_fkey" FOREIGN KEY ("periodId", "tenantId") REFERENCES "ProcessingPeriod"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollExport" ADD CONSTRAINT "PayrollExport_approvalRequestId_tenantId_fkey" FOREIGN KEY ("approvalRequestId", "tenantId") REFERENCES "ApprovalRequest"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollExportItem" ADD CONSTRAINT "PayrollExportItem_payrollExportId_tenantId_fkey" FOREIGN KEY ("payrollExportId", "tenantId") REFERENCES "PayrollExport"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollExportItem" ADD CONSTRAINT "PayrollExportItem_employeeId_tenantId_fkey" FOREIGN KEY ("employeeId", "tenantId") REFERENCES "Employee"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
