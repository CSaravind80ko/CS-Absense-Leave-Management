-- CreateEnum
CREATE TYPE "CompOffCreditStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "ApprovalType" ADD VALUE 'COMP_OFF';

-- AlterTable
ALTER TABLE "ApprovalRequest" ADD COLUMN     "compOffCreditId" UUID;

-- AlterTable
ALTER TABLE "LeaveType" ADD COLUMN     "isCompOff" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "CompOffCredit" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "workedDate" DATE NOT NULL,
    "workedMinutes" INTEGER NOT NULL,
    "creditDays" DECIMAL(5,2) NOT NULL,
    "reason" TEXT,
    "status" "CompOffCreditStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" DATE,
    "version" INTEGER NOT NULL DEFAULT 1,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompOffCredit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CompOffCredit_tenantId_employeeId_status_idx" ON "CompOffCredit"("tenantId", "employeeId", "status");

-- CreateIndex
CREATE INDEX "CompOffCredit_tenantId_status_idx" ON "CompOffCredit"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CompOffCredit_id_tenantId_key" ON "CompOffCredit"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "CompOffCredit_tenantId_employeeId_workedDate_key" ON "CompOffCredit"("tenantId", "employeeId", "workedDate");

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_compOffCreditId_tenantId_fkey" FOREIGN KEY ("compOffCreditId", "tenantId") REFERENCES "CompOffCredit"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompOffCredit" ADD CONSTRAINT "CompOffCredit_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompOffCredit" ADD CONSTRAINT "CompOffCredit_employeeId_tenantId_fkey" FOREIGN KEY ("employeeId", "tenantId") REFERENCES "Employee"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
