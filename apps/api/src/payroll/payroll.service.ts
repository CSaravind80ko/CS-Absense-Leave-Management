import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { pageResult } from '../common/dto/page-query.dto';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePayrollExportDto } from './dto/create-payroll-export.dto';
import {
  PayrollExportQueryDto,
  PayrollRegisterQueryDto,
} from './dto/payroll-query.dto';

interface EmployeeTotals {
  regularMinutes: number;
  overtimeMinutes: number;
  unpaidMinutes: number;
  attendanceDays: number;
}

@Injectable()
export class PayrollService {
  constructor(private readonly prisma: PrismaService) {}

  async register(tenantId: string, query: PayrollRegisterQueryDto) {
    const period = await this.ensurePeriod(tenantId, query.periodId);
    const employeeWhere: Prisma.EmployeeWhereInput = {
      tenantId,
      attendanceDays: { some: { periodId: query.periodId } },
      ...(query.search
        ? {
            OR: [
              {
                employeeNumber: {
                  contains: query.search,
                  mode: 'insensitive',
                },
              },
              {
                firstName: { contains: query.search, mode: 'insensitive' },
              },
              {
                lastName: { contains: query.search, mode: 'insensitive' },
              },
            ],
          }
        : {}),
    };
    const employeeOrder:
      | Prisma.EmployeeOrderByWithRelationInput
      | Prisma.EmployeeOrderByWithRelationInput[] =
      query.sortBy === 'employeeName'
        ? [{ lastName: query.order }, { firstName: query.order }]
        : query.sortBy === 'employeeNumber'
          ? { employeeNumber: query.order }
          : { employeeNumber: 'asc' };
    const [employees, total, blockerRows] = await this.prisma.$transaction([
      this.prisma.employee.findMany({
        where: employeeWhere,
        include: {
          department: { select: { id: true, name: true } },
          attendanceDays: {
            where: { periodId: query.periodId },
            select: {
              scheduledMinutes: true,
              workedMinutes: true,
              overtimeMinutes: true,
            },
          },
        },
        orderBy: employeeOrder,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.employee.count({ where: employeeWhere }),
      this.prisma.attendanceException.findMany({
        where: {
          tenantId,
          status: 'OPEN',
          attendanceDay: { periodId: query.periodId },
          employee: employeeWhere,
          OR: [{ severity: 'CRITICAL' }, { payrollImpact: 'BLOCKED' }],
        },
        distinct: ['employeeId'],
        select: { employeeId: true },
      }),
    ]);
    const blocked = new Set(blockerRows.map((item) => item.employeeId));
    const items = employees.map(({ attendanceDays, ...employee }) => {
      const totals = attendanceDays.reduce<EmployeeTotals>(
        (current, day) => {
          const regularMinutes = Math.max(
            0,
            day.workedMinutes - day.overtimeMinutes,
          );
          current.regularMinutes += regularMinutes;
          current.overtimeMinutes += day.overtimeMinutes;
          current.unpaidMinutes += Math.max(
            0,
            day.scheduledMinutes - regularMinutes,
          );
          current.attendanceDays += 1;
          return current;
        },
        {
          regularMinutes: 0,
          overtimeMinutes: 0,
          unpaidMinutes: 0,
          attendanceDays: 0,
        },
      );
      return {
        employee,
        ...totals,
        readiness: blocked.has(employee.id) ? 'BLOCKED' : 'READY',
      };
    });
    const readyCount = total - blockerRows.length;
    return {
      ...pageResult(items, total, query),
      period,
      readiness: {
        total,
        ready: Math.max(0, readyCount),
        blocked: blockerRows.length,
        readinessPercent:
          total === 0 ? 0 : Math.round((Math.max(0, readyCount) / total) * 100),
      },
    };
  }

  async listExports(tenantId: string, query: PayrollExportQueryDto) {
    const where: Prisma.PayrollExportWhereInput = {
      tenantId,
      periodId: query.periodId,
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.payrollExport.findMany({
        where,
        include: {
          approvalRequest: {
            select: { id: true, status: true, version: true },
          },
          _count: { select: { items: true } },
        },
        orderBy: { [query.sortBy]: query.order },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.payrollExport.count({ where }),
    ]);
    return pageResult(items, total, query);
  }

  async getExport(tenantId: string, id: string) {
    const payrollExport = await this.prisma.payrollExport.findFirst({
      where: { id, tenantId },
      include: {
        period: true,
        approvalRequest: {
          include: { actions: { orderBy: { createdAt: 'asc' } } },
        },
        items: {
          include: {
            employee: {
              select: {
                employeeNumber: true,
                firstName: true,
                lastName: true,
              },
            },
          },
          orderBy: { employee: { employeeNumber: 'asc' } },
        },
      },
    });
    if (!payrollExport) {
      throw new NotFoundException('Payroll export not found');
    }
    return payrollExport;
  }

  async create(
    tenantId: string,
    subject: string,
    dto: CreatePayrollExportDto,
  ) {
    const payrollExport = await this.prisma.$transaction(async (tx) => {
      const period = await tx.processingPeriod.findFirst({
        where: { id: dto.periodId, tenantId },
      });
      if (!period) throw new NotFoundException('Processing period not found');
      if (period.status !== 'APPROVED') {
        throw new BadRequestException('Processing period must be approved');
      }
      if (period.version !== dto.periodVersion) {
        throw new ConflictException(
          'Processing period changed; refresh and retry',
        );
      }
      await this.assertNoCriticalBlockers(tenantId, dto.periodId, tx);
      if (dto.approvalRequestId) {
        const approval = await tx.approvalRequest.findFirst({
          where: {
            id: dto.approvalRequestId,
            tenantId,
            periodId: dto.periodId,
            type: 'PAYROLL_EXPORT',
            status: 'APPROVED',
          },
        });
        if (!approval) {
          throw new BadRequestException(
            'The payroll export approval is not approved for this period',
          );
        }
      }
      const attendanceDays = await tx.attendanceDay.count({
        where: { tenantId, periodId: dto.periodId },
      });
      if (attendanceDays === 0) {
        throw new BadRequestException(
          'No attendance days are available for export',
        );
      }
      const created = await tx.payrollExport.create({
        data: {
          tenantId,
          periodId: dto.periodId,
          periodVersion: dto.periodVersion,
          approvalRequestId: dto.approvalRequestId,
          format: dto.format,
          status: 'DRAFT',
          requestedBy: subject,
        },
      });
      await tx.auditEvent.create({
        data: {
          tenantId,
          actorSubject: subject,
          action: 'payroll.export.requested',
          entityType: 'PayrollExport',
          entityId: created.id,
          metadata: {
            periodId: dto.periodId,
            periodVersion: dto.periodVersion,
            format: dto.format,
          },
        },
      });
      return created;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return {
      payrollExport,
      workerConnected: false,
      dispatch: {
        eventType: 'payroll.export.requested.v1',
        payload: {
          tenantId,
          periodId: dto.periodId,
          periodVersion: dto.periodVersion,
          payrollExportId: payrollExport.id,
          format: dto.format,
          requestedBy: subject,
          requestedAt: payrollExport.createdAt.toISOString(),
        },
      },
    };
  }

  private async ensurePeriod(tenantId: string, id: string) {
    const period = await this.prisma.processingPeriod.findFirst({
      where: { id, tenantId },
    });
    if (!period) throw new NotFoundException('Processing period not found');
    return period;
  }

  private async assertNoCriticalBlockers(
    tenantId: string,
    periodId: string,
    client: Prisma.TransactionClient = this.prisma,
  ): Promise<void> {
    const blockers = await client.attendanceException.count({
      where: {
        tenantId,
        status: 'OPEN',
        attendanceDay: { periodId },
        OR: [{ severity: 'CRITICAL' }, { payrollImpact: 'BLOCKED' }],
      },
    });
    if (blockers) {
      throw new BadRequestException(
        `${blockers} unresolved critical attendance blocker(s) prevent payroll export`,
      );
    }
  }
}
