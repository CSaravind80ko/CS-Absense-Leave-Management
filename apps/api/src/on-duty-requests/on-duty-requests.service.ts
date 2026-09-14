import { ApplicationRole, OnDutyRequest, Prisma } from '@prisma/client';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PageResult, pageResult } from '../common/dto/page-query.dto';
import { PrismaService } from '../prisma/prisma.service';
import { EmployeesService } from '../employees/employees.service';
import { CreateOnDutyRequestDto } from './dto/create-on-duty-request.dto';
import { OnDutyRequestQueryDto } from './dto/on-duty-request-query.dto';

const MS_PER_DAY = 86_400_000;

const ON_DUTY_REQUEST_INCLUDE = {
  employee: { select: { id: true, employeeNumber: true, firstName: true, lastName: true } },
  approvalRequests: { orderBy: { createdAt: 'desc' as const }, take: 1 },
};

@Injectable()
export class OnDutyRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly employees: EmployeesService,
  ) {}

  async list(
    tenantId: string,
    subject: string,
    role: ApplicationRole,
    query: OnDutyRequestQueryDto,
  ): Promise<PageResult<OnDutyRequest>> {
    const employeeId =
      role === 'EMPLOYEE'
        ? (await this.employees.getByCognitoSubject(tenantId, subject)).id
        : query.employeeId;
    const where: Prisma.OnDutyRequestWhereInput = { tenantId, employeeId, status: query.status };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.onDutyRequest.findMany({
        where,
        include: ON_DUTY_REQUEST_INCLUDE,
        orderBy: { createdAt: query.order },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.onDutyRequest.count({ where }),
    ]);
    return pageResult(items, total, query);
  }

  async get(tenantId: string, subject: string, role: ApplicationRole, id: string) {
    const request = await this.prisma.onDutyRequest.findFirst({
      where: { id, tenantId },
      include: ON_DUTY_REQUEST_INCLUDE,
    });
    if (!request) throw new NotFoundException('On-duty request not found');
    if (role === 'EMPLOYEE') {
      const employee = await this.employees.getByCognitoSubject(tenantId, subject);
      if (request.employeeId !== employee.id) {
        throw new NotFoundException('On-duty request not found');
      }
    }
    return request;
  }

  /**
   * Mirrors LeaveRequestsService.submit's shape (self-service, creates the routing
   * ApprovalRequest/ApprovalAction/AuditEvent in the same transaction rather than composing
   * with ApprovalsService.create) minus any balance concept - on-duty has none.
   */
  async submit(tenantId: string, subject: string, dto: CreateOnDutyRequestDto): Promise<OnDutyRequest> {
    const employee = await this.employees.getByCognitoSubject(tenantId, subject);

    const startDate = new Date(dto.startDate);
    const endDate = new Date(dto.endDate);
    if (startDate.getTime() > endDate.getTime()) {
      throw new BadRequestException('startDate must not be after endDate');
    }
    const halfDay = dto.halfDay ?? false;
    if (halfDay && startDate.getTime() !== endDate.getTime()) {
      throw new BadRequestException('halfDay requests must have the same startDate and endDate');
    }
    const totalDays = halfDay
      ? 0.5
      : Math.round((endDate.getTime() - startDate.getTime()) / MS_PER_DAY) + 1;

    const [overlappingOnDuty, overlappingLeave] = await Promise.all([
      this.prisma.onDutyRequest.count({
        where: {
          tenantId,
          employeeId: employee.id,
          status: { in: ['PENDING', 'APPROVED'] },
          startDate: { lte: endDate },
          endDate: { gte: startDate },
        },
      }),
      this.prisma.leaveRequest.count({
        where: {
          tenantId,
          employeeId: employee.id,
          status: { in: ['PENDING', 'APPROVED'] },
          startDate: { lte: endDate },
          endDate: { gte: startDate },
        },
      }),
    ]);
    if (overlappingOnDuty) {
      throw new ConflictException(
        'An existing pending or approved on-duty request already covers part of this date range',
      );
    }
    if (overlappingLeave) {
      throw new ConflictException(
        'A pending or approved leave request already covers part of this date range',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const request = await tx.onDutyRequest.create({
        data: {
          tenantId,
          employeeId: employee.id,
          category: dto.category,
          startDate,
          endDate,
          halfDay,
          totalDays,
          location: dto.location?.trim() || null,
          reason: dto.reason.trim(),
        },
      });
      const approval = await tx.approvalRequest.create({
        data: {
          tenantId,
          type: 'ON_DUTY',
          onDutyRequestId: request.id,
          requestedBy: subject,
          assigneeRole: 'MANAGER',
        },
      });
      await tx.approvalAction.create({
        data: {
          tenantId,
          approvalRequestId: approval.id,
          action: 'SUBMITTED',
          actorSubject: subject,
        },
      });
      await tx.auditEvent.create({
        data: {
          tenantId,
          actorSubject: subject,
          action: 'on_duty_request.submitted',
          entityType: 'OnDutyRequest',
          entityId: request.id,
          after: {
            category: request.category,
            startDate: dto.startDate,
            endDate: dto.endDate,
            totalDays: request.totalDays.toString(),
          },
        },
      });
      return request;
    });
  }
}
