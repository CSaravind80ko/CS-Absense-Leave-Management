import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AttendanceImportJob,
  PeriodStatus,
  Prisma,
  ProcessingPeriod,
} from '@prisma/client';
import {
  PageResult,
  pageResult,
} from '../common/dto/page-query.dto';
import { PrismaService } from '../prisma/prisma.service';
import {
  AttendanceRegisterQueryDto,
  DashboardQueryDto,
  ImportQueryDto,
  PeriodQueryDto,
} from './dto/attendance-query.dto';
import { CreateImportJobDto } from './dto/create-import-job.dto';
import { CreatePeriodDto } from './dto/create-period.dto';
import { UpdatePeriodStatusDto } from './dto/update-period-status.dto';

const FORWARD_TRANSITIONS: Readonly<
  Partial<Record<PeriodStatus, readonly PeriodStatus[]>>
> = {
  OPEN: ['PROCESSING'],
  PROCESSING: ['REVIEW'],
  REVIEW: ['APPROVED'],
  APPROVED: ['EXPORTED'],
  EXPORTED: ['CLOSED'],
};

const REOPEN_TRANSITIONS: Readonly<
  Partial<Record<PeriodStatus, readonly PeriodStatus[]>>
> = {
  PROCESSING: ['OPEN'],
  REVIEW: ['PROCESSING'],
  APPROVED: ['REVIEW'],
  EXPORTED: ['REVIEW'],
};

@Injectable()
export class AttendanceService {
  constructor(private readonly prisma: PrismaService) {}

  async listPeriods(
    tenantId: string,
    query: PeriodQueryDto,
  ): Promise<PageResult<ProcessingPeriod>> {
    const where: Prisma.ProcessingPeriodWhereInput = {
      tenantId,
      status: query.status,
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.processingPeriod.findMany({
        where,
        orderBy: { [query.sortBy]: query.order },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.processingPeriod.count({ where }),
    ]);
    return pageResult(items, total, query);
  }

  async getPeriod(tenantId: string, id: string) {
    const period = await this.prisma.processingPeriod.findFirst({
      where: { id, tenantId },
      include: {
        _count: {
          select: {
            attendanceDays: true,
            importJobs: true,
            approvalRequests: true,
            payrollExports: true,
          },
        },
      },
    });
    if (!period) throw new NotFoundException('Processing period not found');
    return period;
  }

  async createPeriod(
    tenantId: string,
    subject: string,
    dto: CreatePeriodDto,
  ): Promise<ProcessingPeriod> {
    const startsOn = new Date(dto.startsOn);
    const endsOn = new Date(dto.endsOn);
    if (startsOn > endsOn) {
      throw new BadRequestException('startsOn must not be after endsOn');
    }
    const overlap = await this.prisma.processingPeriod.count({
      where: {
        tenantId,
        startsOn: { lte: endsOn },
        endsOn: { gte: startsOn },
      },
    });
    if (overlap) {
      throw new ConflictException(
        'Processing period overlaps an existing period',
      );
    }
    return this.prisma.$transaction(async (tx) => {
      const period = await tx.processingPeriod.create({
        data: { tenantId, name: dto.name, startsOn, endsOn },
      });
      await tx.auditEvent.create({
        data: {
          tenantId,
          actorSubject: subject,
          action: 'attendance.period.created',
          entityType: 'ProcessingPeriod',
          entityId: period.id,
          after: {
            name: period.name,
            startsOn: dto.startsOn,
            endsOn: dto.endsOn,
            status: period.status,
          },
        },
      });
      return period;
    });
  }

  async updatePeriodStatus(
    tenantId: string,
    id: string,
    subject: string,
    dto: UpdatePeriodStatusDto,
  ): Promise<ProcessingPeriod> {
    const period = await this.prisma.processingPeriod.findFirst({
      where: { id, tenantId },
    });
    if (!period) throw new NotFoundException('Processing period not found');

    const forward = FORWARD_TRANSITIONS[period.status]?.includes(dto.status);
    const reopen = REOPEN_TRANSITIONS[period.status]?.includes(dto.status);
    if (!forward && !reopen) {
      throw new BadRequestException(
        `Cannot transition period from ${period.status} to ${dto.status}`,
      );
    }
    if (reopen && !dto.reason?.trim()) {
      throw new BadRequestException('A reason is required to reopen a period');
    }
    return this.prisma.$transaction(async (tx) => {
      if (dto.status === 'APPROVED' || dto.status === 'EXPORTED') {
        await this.assertNoCriticalBlockers(tenantId, id, tx);
      }
      if (dto.status === 'EXPORTED') {
        const readyExport = await tx.payrollExport.count({
          where: {
            tenantId,
            periodId: id,
            periodVersion: period.version,
            status: 'READY',
          },
        });
        if (readyExport === 0) {
          throw new BadRequestException(
            'A ready payroll export is required before marking the period exported',
          );
        }
      }
      const updated = await tx.processingPeriod.updateMany({
        where: { id, tenantId, version: dto.version, status: period.status },
        data: {
          status: dto.status,
          version: { increment: 1 },
          lockedAt: dto.status === 'APPROVED' ? new Date() : reopen ? null : period.lockedAt,
          reopenedAt: reopen ? new Date() : period.reopenedAt,
          reopenReason: reopen ? dto.reason?.trim() : period.reopenReason,
        },
      });
      if (updated.count !== 1) {
        throw new ConflictException(
          'Processing period changed; refresh and retry with the latest version',
        );
      }
      await tx.auditEvent.create({
        data: {
          tenantId,
          actorSubject: subject,
          action: reopen
            ? 'attendance.period.reopened'
            : 'attendance.period.transitioned',
          entityType: 'ProcessingPeriod',
          entityId: id,
          before: { status: period.status, version: period.version },
          after: {
            status: dto.status,
            version: period.version + 1,
            reason: dto.reason?.trim(),
          },
        },
      });
      return tx.processingPeriod.findFirstOrThrow({
        where: { id, tenantId },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async listRegister(tenantId: string, query: AttendanceRegisterQueryDto) {
    await this.ensurePeriod(tenantId, query.periodId);
    const where: Prisma.AttendanceDayWhereInput = {
      tenantId,
      periodId: query.periodId,
      status: query.status,
      employee: {
        departmentId: query.departmentId,
        ...(query.search
          ? {
              OR: [
                {
                  employeeNumber: {
                    contains: query.search,
                    mode: 'insensitive' as const,
                  },
                },
                {
                  firstName: {
                    contains: query.search,
                    mode: 'insensitive' as const,
                  },
                },
                {
                  lastName: {
                    contains: query.search,
                    mode: 'insensitive' as const,
                  },
                },
              ],
            }
          : {}),
      },
    };
    const orderBy: Prisma.AttendanceDayOrderByWithRelationInput =
      query.sortBy === 'employeeNumber'
        ? { employee: { employeeNumber: query.order } }
        : query.sortBy === 'employeeName'
          ? { employee: { lastName: query.order } }
          : { [query.sortBy]: query.order };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.attendanceDay.findMany({
        where,
        include: {
          employee: {
            select: {
              id: true,
              employeeNumber: true,
              firstName: true,
              lastName: true,
              department: { select: { id: true, name: true } },
              location: { select: { id: true, name: true } },
              shift: { select: { id: true, name: true } },
            },
          },
          exceptions: {
            where: { status: 'OPEN' },
            select: {
              id: true,
              severity: true,
              payrollImpact: true,
              type: true,
            },
          },
        },
        orderBy,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.attendanceDay.count({ where }),
    ]);
    return pageResult(items, total, query);
  }

  async getAttendanceDay(tenantId: string, id: string) {
    const day = await this.prisma.attendanceDay.findFirst({
      where: { id, tenantId },
      include: {
        period: true,
        employee: {
          include: { department: true, location: true, shift: true },
        },
        exceptions: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!day) throw new NotFoundException('Attendance day not found');
    const start = new Date(day.workDate);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 1);
    const punches = await this.prisma.attendancePunch.findMany({
      where: {
        tenantId,
        employeeId: day.employeeId,
        occurredAt: { gte: start, lt: end },
      },
      include: {
        location: { select: { id: true, name: true } },
        importRow: { select: { id: true, fileId: true, rowNumber: true } },
      },
      orderBy: { occurredAt: 'asc' },
    });
    return { ...day, punches };
  }

  async dashboard(tenantId: string, query: DashboardQueryDto) {
    const period = await this.ensurePeriod(tenantId, query.periodId);
    const [
      activeEmployees,
      processedEmployees,
      openExceptions,
      blockingEmployees,
      pendingApprovals,
      imports,
      recentActivity,
    ] = await this.prisma.$transaction([
      this.prisma.employee.count({ where: { tenantId, status: 'ACTIVE' } }),
      this.prisma.attendanceDay.findMany({
        where: { tenantId, periodId: query.periodId },
        distinct: ['employeeId'],
        select: { employeeId: true },
      }),
      this.prisma.attendanceException.count({
        where: {
          tenantId,
          status: 'OPEN',
          attendanceDay: { periodId: query.periodId },
        },
      }),
      this.prisma.attendanceException.findMany({
        where: {
          tenantId,
          status: 'OPEN',
          attendanceDay: { periodId: query.periodId },
          OR: [{ severity: 'CRITICAL' }, { payrollImpact: 'BLOCKED' }],
        },
        distinct: ['employeeId'],
        select: { employeeId: true },
      }),
      this.prisma.approvalRequest.count({
        where: {
          tenantId,
          status: 'PENDING',
          OR: [
            { periodId: query.periodId },
            { exception: { attendanceDay: { periodId: query.periodId } } },
          ],
        },
      }),
      this.prisma.attendanceImportJob.findMany({
        where: { tenantId, periodId: query.periodId },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
      this.prisma.auditEvent.findMany({
        where: {
          tenantId,
          entityType: {
            in: [
              'ProcessingPeriod',
              'AttendanceException',
              'ApprovalRequest',
              'PayrollExport',
            ],
          },
        },
        orderBy: { occurredAt: 'desc' },
        take: 8,
      }),
    ]);
    const processed = processedEmployees.length;
    const blocked = blockingEmployees.length;
    const ready = Math.max(0, processed - blocked);
    return {
      period,
      metrics: {
        activeEmployees,
        attendanceProcessed: processed,
        payrollReady: ready,
        openExceptions,
        criticalBlockers: blocked,
        pendingApprovals,
        readinessPercent: processed === 0 ? 0 : Math.round((ready / processed) * 100),
      },
      imports,
      recentActivity,
    };
  }

  async listImportJobs(
    tenantId: string,
    query: ImportQueryDto,
  ): Promise<PageResult<AttendanceImportJob>> {
    const where: Prisma.AttendanceImportJobWhereInput = {
      tenantId,
      periodId: query.periodId,
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.attendanceImportJob.findMany({
        where,
        orderBy: { [query.sortBy]: query.order },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.attendanceImportJob.count({ where }),
    ]);
    return pageResult(items, total, query);
  }

  async createImportJob(
    tenantId: string,
    subject: string,
    dto: CreateImportJobDto,
  ) {
    const period = await this.ensurePeriod(tenantId, dto.periodId);
    if (!['OPEN', 'PROCESSING'].includes(period.status)) {
      throw new BadRequestException(
        'Imports are only allowed in open processing periods',
      );
    }
    const job = await this.prisma.$transaction(async (tx) => {
      const created = await tx.attendanceImportJob.create({
        data: {
          tenantId,
          periodId: dto.periodId,
          requestedBy: subject,
          source: dto.source,
        },
      });
      await tx.auditEvent.create({
        data: {
          tenantId,
          actorSubject: subject,
          action: 'attendance.import.requested',
          entityType: 'AttendanceImportJob',
          entityId: created.id,
          metadata: { periodId: dto.periodId, source: dto.source },
        },
      });
      return created;
    });
    return {
      job,
      workerConnected: false,
      dispatch: {
        eventType: 'attendance.import.requested.v1',
        payload: {
          tenantId,
          periodId: dto.periodId,
          importJobId: job.id,
          source: job.source,
          requestedBy: subject,
          requestedAt: job.createdAt.toISOString(),
        },
      },
    };
  }

  private async ensurePeriod(tenantId: string, periodId: string) {
    const period = await this.prisma.processingPeriod.findFirst({
      where: { id: periodId, tenantId },
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
    if (blockers > 0) {
      throw new BadRequestException(
        `${blockers} unresolved critical attendance blocker(s) prevent this transition`,
      );
    }
  }
}
