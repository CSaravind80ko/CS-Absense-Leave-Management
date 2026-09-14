import { ApplicationRole, LeaveRequest, Prisma } from '@prisma/client';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PageResult, pageResult } from '../common/dto/page-query.dto';
import { PrismaService } from '../prisma/prisma.service';
import { EmployeesService } from '../employees/employees.service';
import { CreateLeaveRequestDto } from './dto/create-leave-request.dto';
import { LeaveRequestQueryDto } from './dto/leave-request-query.dto';

const MS_PER_DAY = 86_400_000;

const LEAVE_REQUEST_INCLUDE = {
  employee: { select: { id: true, employeeNumber: true, firstName: true, lastName: true } },
  leaveType: true,
  approvalRequests: { orderBy: { createdAt: 'desc' as const }, take: 1 },
};

@Injectable()
export class LeaveRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly employees: EmployeesService,
  ) {}

  async list(
    tenantId: string,
    subject: string,
    role: ApplicationRole,
    query: LeaveRequestQueryDto,
  ): Promise<PageResult<LeaveRequest>> {
    const employeeId =
      role === 'EMPLOYEE'
        ? (await this.employees.getByCognitoSubject(tenantId, subject)).id
        : query.employeeId;
    const where: Prisma.LeaveRequestWhereInput = {
      tenantId,
      employeeId,
      status: query.status,
      leaveTypeId: query.leaveTypeId,
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.leaveRequest.findMany({
        where,
        include: LEAVE_REQUEST_INCLUDE,
        orderBy: { createdAt: query.order },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.leaveRequest.count({ where }),
    ]);
    return pageResult(items, total, query);
  }

  async get(tenantId: string, subject: string, role: ApplicationRole, id: string) {
    const request = await this.prisma.leaveRequest.findFirst({
      where: { id, tenantId },
      include: LEAVE_REQUEST_INCLUDE,
    });
    if (!request) throw new NotFoundException('Leave request not found');
    if (role === 'EMPLOYEE') {
      const employee = await this.employees.getByCognitoSubject(tenantId, subject);
      if (request.employeeId !== employee.id) {
        throw new NotFoundException('Leave request not found');
      }
    }
    return request;
  }

  /**
   * Creates the LeaveRequest and its routing ApprovalRequest/ApprovalAction/AuditEvent
   * together. This duplicates a slice of ApprovalsService.create rather than composing with
   * it, because that service always opens its own $transaction - the same tradeoff
   * HolidaysService and ShiftsService already made for their own recompute-enqueue logic
   * (no shared business-logic layer between modules today).
   */
  async submit(tenantId: string, subject: string, dto: CreateLeaveRequestDto): Promise<LeaveRequest> {
    const employee = await this.employees.getByCognitoSubject(tenantId, subject);
    const leaveType = await this.prisma.leaveType.findFirst({
      where: { id: dto.leaveTypeId, tenantId, active: true },
    });
    if (!leaveType) throw new BadRequestException('Leave type was not found or is inactive');

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

    const overlapping = await this.prisma.leaveRequest.count({
      where: {
        tenantId,
        employeeId: employee.id,
        status: { in: ['PENDING', 'APPROVED'] },
        startDate: { lte: endDate },
        endDate: { gte: startDate },
      },
    });
    if (overlapping) {
      throw new ConflictException(
        'An existing pending or approved leave request already covers part of this date range',
      );
    }

    // A fail-fast check for immediate feedback; the authoritative check (and the actual
    // deduction) happens atomically in ApprovalsService.act when this is approved, since
    // multiple pending requests can't be safely reconciled against a shared balance until
    // one of them is actually decided.
    if (leaveType.paid) {
      const balance = await this.prisma.leaveBalance.findFirst({
        where: {
          tenantId,
          employeeId: employee.id,
          leaveTypeId: leaveType.id,
          year: startDate.getUTCFullYear(),
        },
      });
      const available = balance ? balance.allocatedDays.minus(balance.usedDays).toNumber() : 0;
      if (available < totalDays) {
        throw new BadRequestException(
          `Insufficient ${leaveType.name} balance: ${available} day(s) available, ${totalDays} requested`,
        );
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const request = await tx.leaveRequest.create({
        data: {
          tenantId,
          employeeId: employee.id,
          leaveTypeId: leaveType.id,
          startDate,
          endDate,
          halfDay,
          totalDays,
          reason: dto.reason?.trim() || null,
        },
      });
      const approval = await tx.approvalRequest.create({
        data: {
          tenantId,
          type: 'LEAVE',
          leaveRequestId: request.id,
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
          action: 'leave_request.submitted',
          entityType: 'LeaveRequest',
          entityId: request.id,
          after: {
            leaveTypeId: request.leaveTypeId,
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
