import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PayrollExport } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePayrollExportDto } from './dto/create-payroll-export.dto';

interface EmployeeTotals {
  regularMinutes: number;
  overtimeMinutes: number;
  unpaidMinutes: number;
}

@Injectable()
export class PayrollService {
  constructor(private readonly prisma: PrismaService) {}

  list(tenantId: string): Promise<PayrollExport[]> {
    return this.prisma.payrollExport.findMany({
      where: { tenantId },
      include: { items: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(
    tenantId: string,
    subject: string,
    dto: CreatePayrollExportDto,
  ): Promise<PayrollExport> {
    const period = await this.prisma.processingPeriod.findFirst({
      where: { id: dto.periodId, tenantId },
    });
    if (!period) throw new NotFoundException('Processing period not found');
    if (period.status !== 'APPROVED') {
      throw new BadRequestException('Processing period must be approved');
    }
    const approval = await this.prisma.approvalRequest.findFirst({
      where: {
        id: dto.approvalRequestId,
        tenantId,
        periodId: dto.periodId,
        type: 'PAYROLL_EXPORT',
        status: 'APPROVED',
      },
    });
    if (!approval) {
      throw new BadRequestException('An approved payroll export request is required');
    }

    const days = await this.prisma.attendanceDay.findMany({
      where: { tenantId, periodId: dto.periodId },
      select: {
        employeeId: true,
        workedMinutes: true,
        overtimeMinutes: true,
        scheduledMinutes: true,
      },
    });
    if (days.length === 0) {
      throw new BadRequestException('No attendance days are available for export');
    }
    const totals = new Map<string, EmployeeTotals>();
    for (const day of days) {
      const current = totals.get(day.employeeId) ?? {
        regularMinutes: 0,
        overtimeMinutes: 0,
        unpaidMinutes: 0,
      };
      const regularWorked = Math.max(0, day.workedMinutes - day.overtimeMinutes);
      current.regularMinutes += regularWorked;
      current.overtimeMinutes += day.overtimeMinutes;
      current.unpaidMinutes += Math.max(0, day.scheduledMinutes - regularWorked);
      totals.set(day.employeeId, current);
    }

    return this.prisma.$transaction(async (tx) => {
      const payrollExport = await tx.payrollExport.create({
        data: {
          tenantId,
          periodId: dto.periodId,
          approvalRequestId: dto.approvalRequestId,
          format: dto.format.toUpperCase(),
          status: 'READY',
          requestedBy: subject,
          generatedAt: new Date(),
        },
      });
      await tx.payrollExportItem.createMany({
        data: [...totals.entries()].map(([employeeId, value]) => ({
          tenantId,
          payrollExportId: payrollExport.id,
          employeeId,
          ...value,
        })),
      });
      await tx.processingPeriod.update({
        where: { id: dto.periodId },
        data: { status: 'EXPORTED' },
      });
      await tx.auditEvent.create({
        data: {
          tenantId,
          actorSubject: subject,
          action: 'payroll.export.generated',
          entityType: 'PayrollExport',
          entityId: payrollExport.id,
          metadata: { format: payrollExport.format, itemCount: totals.size },
        },
      });
      return payrollExport;
    });
  }
}
