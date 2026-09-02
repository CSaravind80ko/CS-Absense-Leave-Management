-- CreateEnum
CREATE TYPE "PolicyScopeType" AS ENUM ('TENANT', 'LOCATION', 'DEPARTMENT', 'EMPLOYEE_GROUP', 'EMPLOYEE');

-- CreateEnum
CREATE TYPE "PolicyVersionStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "PolicyRecomputeStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- AlterTable
ALTER TABLE "AttendanceDay"
ADD COLUMN "policyVersionId" UUID,
ADD COLUMN "calculationTrace" JSONB;

-- CreateTable
CREATE TABLE "PolicyVersion" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "scopeType" "PolicyScopeType" NOT NULL,
    "scopeId" UUID NOT NULL,
    "status" "PolicyVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "name" TEXT NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "workingWeekdays" INTEGER[] NOT NULL DEFAULT ARRAY[1,2,3,4,5]::INTEGER[],
    "rules" JSONB NOT NULL,
    "supersedesId" UUID,
    "publishedAt" TIMESTAMP(3),
    "publishedBy" TEXT,
    "createdBy" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PolicyVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeGroup" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EmployeeGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeGroupMember" (
    "tenantId" UUID NOT NULL,
    "groupId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EmployeeGroupMember_pkey" PRIMARY KEY ("groupId","employeeId")
);

-- CreateTable
CREATE TABLE "Holiday" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "locationId" UUID,
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Holiday_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PolicyRecomputeJob" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "scopeType" "PolicyScopeType" NOT NULL,
    "scopeId" UUID NOT NULL,
    "dateFrom" DATE NOT NULL,
    "dateTo" DATE NOT NULL,
    "reason" TEXT NOT NULL,
    "triggeredByPolicyVersionId" UUID,
    "requestedBy" TEXT NOT NULL,
    "status" "PolicyRecomputeStatus" NOT NULL DEFAULT 'PENDING',
    "daysMatched" INTEGER NOT NULL DEFAULT 0,
    "daysRecomputed" INTEGER NOT NULL DEFAULT 0,
    "exceptionsOpened" INTEGER NOT NULL DEFAULT 0,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PolicyRecomputeJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AttendanceDay_tenantId_policyVersionId_idx" ON "AttendanceDay"("tenantId", "policyVersionId");
CREATE UNIQUE INDEX "PolicyVersion_id_tenantId_key" ON "PolicyVersion"("id", "tenantId");
CREATE UNIQUE INDEX "PolicyVersion_tenantId_scopeType_scopeId_effectiveFrom_key" ON "PolicyVersion"("tenantId", "scopeType", "scopeId", "effectiveFrom");
CREATE INDEX "PolicyVersion_tenantId_scopeType_scopeId_status_effectiveFrom_idx" ON "PolicyVersion"("tenantId", "scopeType", "scopeId", "status", "effectiveFrom");
CREATE INDEX "PolicyVersion_tenantId_status_idx" ON "PolicyVersion"("tenantId", "status");
CREATE UNIQUE INDEX "EmployeeGroup_tenantId_code_key" ON "EmployeeGroup"("tenantId", "code");
CREATE UNIQUE INDEX "EmployeeGroup_id_tenantId_key" ON "EmployeeGroup"("id", "tenantId");
CREATE INDEX "EmployeeGroup_tenantId_name_idx" ON "EmployeeGroup"("tenantId", "name");
CREATE INDEX "EmployeeGroupMember_tenantId_employeeId_idx" ON "EmployeeGroupMember"("tenantId", "employeeId");
CREATE INDEX "Holiday_tenantId_date_idx" ON "Holiday"("tenantId", "date");
CREATE INDEX "Holiday_tenantId_locationId_date_idx" ON "Holiday"("tenantId", "locationId", "date");
CREATE UNIQUE INDEX "PolicyRecomputeJob_id_tenantId_key" ON "PolicyRecomputeJob"("id", "tenantId");
CREATE INDEX "PolicyRecomputeJob_tenantId_status_idx" ON "PolicyRecomputeJob"("tenantId", "status");
CREATE INDEX "PolicyRecomputeJob_tenantId_createdAt_idx" ON "PolicyRecomputeJob"("tenantId", "createdAt");

-- AddForeignKey
ALTER TABLE "AttendanceDay" ADD CONSTRAINT "AttendanceDay_policyVersionId_tenantId_fkey" FOREIGN KEY ("policyVersionId", "tenantId") REFERENCES "PolicyVersion"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PolicyVersion" ADD CONSTRAINT "PolicyVersion_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PolicyVersion" ADD CONSTRAINT "PolicyVersion_supersedesId_tenantId_fkey" FOREIGN KEY ("supersedesId", "tenantId") REFERENCES "PolicyVersion"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EmployeeGroup" ADD CONSTRAINT "EmployeeGroup_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EmployeeGroupMember" ADD CONSTRAINT "EmployeeGroupMember_groupId_tenantId_fkey" FOREIGN KEY ("groupId", "tenantId") REFERENCES "EmployeeGroup"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EmployeeGroupMember" ADD CONSTRAINT "EmployeeGroupMember_employeeId_tenantId_fkey" FOREIGN KEY ("employeeId", "tenantId") REFERENCES "Employee"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Holiday" ADD CONSTRAINT "Holiday_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Holiday" ADD CONSTRAINT "Holiday_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PolicyRecomputeJob" ADD CONSTRAINT "PolicyRecomputeJob_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PolicyRecomputeJob" ADD CONSTRAINT "PolicyRecomputeJob_triggeredByPolicyVersionId_tenantId_fkey" FOREIGN KEY ("triggeredByPolicyVersionId", "tenantId") REFERENCES "PolicyVersion"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill: every existing tenant gets a PUBLISHED TENANT-scope default policy so the
-- precedence resolution invariant ("tenant-level always has an active version") holds
-- from the moment this migration completes, with no separate script to sequence.
INSERT INTO "PolicyVersion" (
    "id", "tenantId", "scopeType", "scopeId", "status", "name",
    "effectiveFrom", "workingWeekdays", "rules",
    "publishedAt", "publishedBy", "createdBy", "version", "createdAt", "updatedAt"
)
SELECT
    gen_random_uuid(),
    "id",
    'TENANT',
    "id",
    'PUBLISHED',
    'Default Tenant Policy',
    CURRENT_DATE,
    ARRAY[1,2,3,4,5]::INTEGER[],
    '{"lateArrival":{"graceMinutes":10},"earlyDeparture":{"graceMinutes":10},"overtime":{"thresholdMinutes":0,"dailyCapMinutes":180,"roundingMinutes":15},"halfDay":{"halfDayThresholdMinutes":240},"absence":{"lop":true}}'::JSONB,
    CURRENT_TIMESTAMP,
    'system:migration',
    'system:migration',
    1,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "Tenant";
