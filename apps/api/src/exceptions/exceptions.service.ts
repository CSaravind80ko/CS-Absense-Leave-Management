import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AttendanceException, Prisma } from '@prisma/client';
import { pageResult } from '../common/dto/page-query.dto';
import { PrismaService } from '../prisma/prisma.service';
import {
  AssignExceptionDto,
  ExceptionQueryDto,
} from './dto/exception-query.dto';
import { DecideExceptionDto } from './dto/decide-exception.dto';

@Injectable()
export class ExceptionsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(tenantId: string, query: ExceptionQueryDto) {
    await this.ensurePeriod(tenantId, query.periodId);
    const where: Prisma.AttendanceExceptionWhereInput = {
      tenantId,
      status: query.status,
      severity: query.severity,
      type: query.type,
      assignedToSubject: query.assignedToSubject,
      attendanceDay: { periodId: query.periodId },
      ...(query.search
        ? {
            OR: [
              {
                employee: {
                  employeeNumber: {
                    contains: query.search,
                    mode: 'insensitive',
                  },
                },
              },
              {
                employee: {
                  firstName: { contains: query.search, mode: 'insensitive' },
                },
              },
              {
                employee: {
                  lastName: { contains: query.search, mode: 'insensitive' },
                },
              },
            ],
          }
        : {}),
    };
    const [items, total, open, critical, blocked] =
      await this.prisma.$transaction([
        this.prisma.attendanceException.findMany({
          where,
          include: {
            employee: {
              select: {
                id: true,
                employeeNumber: true,
                firstName: true,
                lastName: true,
                department: { select: { id: true, name: true } },
              },
            },
            attendanceDay: {
              select: { id: true, workDate: true, status: true, version: true },
            },
          },
          orderBy: { [query.sortBy]: query.order },
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        this.prisma.attendanceException.count({ where }),
        this.prisma.attendanceException.count({
          where: {
            tenantId,
            status: 'OPEN',
            attendanceDay: { periodId: query.periodId },
          },
        }),
        this.prisma.attendanceException.count({
          where: {
            tenantId,
            status: 'OPEN',
            severity: 'CRITICAL',
            attendanceDay: { periodId: query.periodId },
          },
        }),
        this.prisma.attendanceException.count({
          where: {
            tenantId,
            status: 'OPEN',
            payrollImpact: 'BLOCKED',
            attendanceDay: { periodId: query.periodId },
          },
        }),
      ]);
    return {
      ...pageResult(items, total, query),
      summary: { open, critical, blocked },
    };
  }

  async get(tenantId: string, id: string) {
    const exception = await this.prisma.attendanceException.findFirst({
      where: { id, tenantId },
      include: {
        employee: {
          include: { department: true, location: true, shift: true },
        },
        attendanceDay: true,
        approvalRequests: {
          include: { actions: { orderBy: { createdAt: 'asc' } } },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!exception) {
      throw new NotFoundException('Attendance exception not found');
    }
    return exception;
  }

  async assign(
    tenantId: string,
    id: string,
    subject: string,
    dto: AssignExceptionDto,
  ): Promise<AttendanceException> {
    const existing = await this.findException(tenantId, id);
    if (existing.status !== 'OPEN') {
      throw new BadRequestException('Only open exceptions can be assigned');
    }
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.attendanceException.updateMany({
        where: { id, tenantId, status: 'OPEN', version: dto.version },
        data: {
          assignedToSubject: dto.assignedToSubject,
          assignedToRole: dto.assignedToRole,
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) {
        throw new ConflictException(
          'Attendance exception changed; refresh and retry',
        );
      }
      await tx.auditEvent.create({
        data: {
          tenantId,
          actorSubject: subject,
          action: 'exception.assigned',
          entityType: 'AttendanceException',
          entityId: id,
          before: {
            assignedToSubject: existing.assignedToSubject,
            assignedToRole: existing.assignedToRole,
            version: existing.version,
          },
          after: {
            assignedToSubject: dto.assignedToSubject,
            assignedToRole: dto.assignedToRole,
            version: existing.version + 1,
          },
        },
      });
      return tx.attendanceException.findFirstOrThrow({
        where: { id, tenantId },
      });
    });
  }

  async decide(
    tenantId: string,
    id: string,
    subject: string,
    dto: DecideExceptionDto,
  ): Promise<AttendanceException> {
    if (dto.decision === 'OPEN') {
      throw new BadRequestException(
        'Decision must resolve or dismiss the exception',
      );
    }
    const existing = await this.findException(tenantId, id);
    if (existing.status !== 'OPEN') {
      throw new BadRequestException('Exception has already been decided');
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.attendanceException.updateMany({
        where: { id, tenantId, status: 'OPEN', version: dto.version },
        data: {
          status: dto.decision,
          resolutionNote: dto.note.trim(),
          resolvedBy: subject,
          resolvedAt: new Date(),
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) {
        throw new ConflictException(
          'Attendance exception changed; refresh and retry',
        );
      }
      const exception = await tx.attendanceException.findFirstOrThrow({
        where: { id, tenantId },
      });
      await tx.auditEvent.create({
        data: {
          tenantId,
          actorSubject: subject,
          action: `exception.${dto.decision.toLowerCase()}`,
          entityType: 'AttendanceException',
          entityId: id,
          before: {
            status: existing.status,
            version: existing.version,
            payrollImpact: existing.payrollImpact,
          },
          after: {
            status: dto.decision,
            note: dto.note.trim(),
            version: exception.version,
          },
        },
      });
      return exception;
    });
  }

  private async findException(
    tenantId: string,
    id: string,
  ): Promise<AttendanceException> {
    const exception = await this.prisma.attendanceException.findFirst({
      where: { id, tenantId },
    });
    if (!exception) {
      throw new NotFoundException('Attendance exception not found');
    }
    return exception;
  }

  private async ensurePeriod(tenantId: string, periodId: string): Promise<void> {
    const count = await this.prisma.processingPeriod.count({
      where: { id: periodId, tenantId },
    });
    if (count !== 1) throw new NotFoundException('Processing period not found');
  }
}
