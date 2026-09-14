import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ApplicationRole,
  ApprovalActionType,
  ApprovalRequest,
  ApprovalStatus,
  ApprovalType,
  Prisma,
} from '@prisma/client';
import {
  createEvent,
  type AttendanceDayRecomputeRequestedEvent,
} from '@attendance/contracts';
import { pageResult } from '../common/dto/page-query.dto';
import { PrismaService } from '../prisma/prisma.service';
import { enqueueOutboxEvent } from '../events/outbox';
import { ApprovalActionDto } from './dto/approval-action.dto';
import { ApprovalQueryDto } from './dto/approval-query.dto';
import { CreateApprovalDto } from './dto/create-approval.dto';

const FINAL_ACTION_STATUS: Partial<Record<ApprovalActionType, ApprovalStatus>> = {
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  CANCELLED: 'CANCELLED',
};

const DEFAULT_ASSIGNEE: Record<ApprovalType, ApplicationRole> = {
  ATTENDANCE_PERIOD: 'HR_ADMIN',
  EXCEPTION: 'MANAGER',
  PAYROLL_EXPORT: 'PAYROLL_ADMIN',
  LEAVE: 'MANAGER',
  ON_DUTY: 'MANAGER',
  COMP_OFF: 'MANAGER',
};

const MS_PER_DAY = 86_400_000;
const COMP_OFF_EXPIRY_DAYS = 90;

@Injectable()
export class ApprovalsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    tenantId: string,
    subject: string,
    role: ApplicationRole,
    query: ApprovalQueryDto,
  ) {
    const scope: Prisma.ApprovalRequestWhereInput =
      query.scope === 'requested'
        ? { requestedBy: subject }
        : query.scope === 'inbox'
          ? {
              OR: [
                { assigneeSubject: subject },
                { assigneeSubject: null, assigneeRole: role },
              ],
            }
          : {};
    // LEAVE/ON_DUTY/COMP_OFF requests carry neither periodId nor exceptionId - they aren't
    // scoped to a processing period at all - so a periodId filter must not exclude them, or
    // Team Approvals (which always filters by the currently selected period) would never
    // show one.
    const periodScope: Prisma.ApprovalRequestWhereInput = query.periodId
      ? {
          OR: [
            { periodId: query.periodId },
            { exception: { attendanceDay: { periodId: query.periodId } } },
            { type: 'LEAVE' },
            { type: 'ON_DUTY' },
            { type: 'COMP_OFF' },
          ],
        }
      : {};
    const where: Prisma.ApprovalRequestWhereInput = {
      tenantId,
      status: query.status,
      type: query.type,
      AND: [scope, periodScope],
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.approvalRequest.findMany({
        where,
        include: {
          period: {
            select: { id: true, name: true, startsOn: true, endsOn: true },
          },
          exception: {
            include: {
              employee: {
                select: {
                  id: true,
                  employeeNumber: true,
                  firstName: true,
                  lastName: true,
                },
              },
              attendanceDay: { select: { workDate: true } },
            },
          },
          leaveRequest: {
            include: {
              employee: {
                select: { id: true, employeeNumber: true, firstName: true, lastName: true },
              },
              leaveType: true,
            },
          },
          onDutyRequest: {
            include: {
              employee: {
                select: { id: true, employeeNumber: true, firstName: true, lastName: true },
              },
            },
          },
          compOffCredit: {
            include: {
              employee: {
                select: { id: true, employeeNumber: true, firstName: true, lastName: true },
              },
            },
          },
          actions: { orderBy: { createdAt: 'asc' } },
        },
        orderBy: { [query.sortBy]: query.order },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.approvalRequest.count({ where }),
    ]);
    return pageResult(items, total, query);
  }

  async get(tenantId: string, id: string) {
    const request = await this.prisma.approvalRequest.findFirst({
      where: { id, tenantId },
      include: {
        period: true,
        exception: {
          include: { employee: true, attendanceDay: true },
        },
        leaveRequest: { include: { employee: true, leaveType: true } },
        onDutyRequest: { include: { employee: true } },
        compOffCredit: { include: { employee: true } },
        actions: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!request) throw new NotFoundException('Approval request not found');
    return request;
  }

  async create(
    tenantId: string,
    subject: string,
    dto: CreateApprovalDto,
  ): Promise<ApprovalRequest> {
    this.validateTarget(dto);
    await this.ensureTargetBelongsToTenant(tenantId, dto);
    const duplicate = await this.prisma.approvalRequest.count({
      where: {
        tenantId,
        type: dto.type,
        periodId: dto.periodId,
        exceptionId: dto.exceptionId,
        status: 'PENDING',
      },
    });
    if (duplicate) {
      throw new ConflictException('A pending approval already exists for this target');
    }
    return this.prisma.$transaction(async (tx) => {
      const request = await tx.approvalRequest.create({
        data: {
          tenantId,
          type: dto.type,
          periodId: dto.periodId,
          exceptionId: dto.exceptionId,
          requestedBy: subject,
          assigneeSubject: dto.assigneeSubject,
          assigneeRole:
            dto.assigneeRole ??
            (dto.assigneeSubject ? undefined : DEFAULT_ASSIGNEE[dto.type]),
        },
      });
      await tx.approvalAction.create({
        data: {
          tenantId,
          approvalRequestId: request.id,
          action: 'SUBMITTED',
          actorSubject: subject,
        },
      });
      await tx.auditEvent.create({
        data: {
          tenantId,
          actorSubject: subject,
          action: 'approval.submitted',
          entityType: 'ApprovalRequest',
          entityId: request.id,
          after: {
            type: request.type,
            periodId: request.periodId,
            exceptionId: request.exceptionId,
            assigneeSubject: request.assigneeSubject,
            assigneeRole: request.assigneeRole,
          },
        },
      });
      return request;
    });
  }

  async act(
    tenantId: string,
    id: string,
    subject: string,
    role: ApplicationRole,
    dto: ApprovalActionDto,
  ): Promise<ApprovalRequest> {
    if (dto.action === 'SUBMITTED') {
      throw new BadRequestException('A submitted request cannot be resubmitted');
    }
    if (
      ['REJECTED', 'CANCELLED'].includes(dto.action) &&
      !dto.comment?.trim()
    ) {
      throw new BadRequestException(
        'A comment is required when rejecting or cancelling an approval',
      );
    }
    const request = await this.prisma.approvalRequest.findFirst({
      where: { id, tenantId },
    });
    if (!request) throw new NotFoundException('Approval request not found');
    this.assertActorCanAct(request, subject, role, dto.action);
    if (request.status !== 'PENDING') {
      throw new BadRequestException('Approval request is already final');
    }
    const nextStatus = FINAL_ACTION_STATUS[dto.action];
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.approvalRequest.updateMany({
        where: {
          id,
          tenantId,
          status: 'PENDING',
          version: dto.version,
        },
        data: {
          status: nextStatus,
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) {
        throw new ConflictException('Approval changed; refresh and retry');
      }
      await tx.approvalAction.create({
        data: {
          tenantId,
          approvalRequestId: id,
          action: dto.action,
          actorSubject: subject,
          comment: dto.comment?.trim(),
        },
      });
      await tx.auditEvent.create({
        data: {
          tenantId,
          actorSubject: subject,
          action: `approval.${dto.action.toLowerCase()}`,
          entityType: 'ApprovalRequest',
          entityId: id,
          before: { status: request.status, version: request.version },
          after: {
            status: nextStatus ?? request.status,
            version: request.version + 1,
            comment: dto.comment?.trim(),
          },
        },
      });
      if (request.type === 'LEAVE' && request.leaveRequestId && nextStatus) {
        await this.applyLeaveDecision(tx, tenantId, request.leaveRequestId, nextStatus, subject);
      }
      if (request.type === 'ON_DUTY' && request.onDutyRequestId && nextStatus) {
        await this.applyOnDutyDecision(tx, tenantId, request.onDutyRequestId, nextStatus, subject);
      }
      if (request.type === 'COMP_OFF' && request.compOffCreditId && nextStatus) {
        await this.applyCompOffDecision(tx, tenantId, request.compOffCreditId, nextStatus, subject);
      }
      return tx.approvalRequest.findFirstOrThrow({
        where: { id, tenantId },
      });
    });
  }

  /**
   * Keeps LeaveRequest.status in sync with its ApprovalRequest, and - only on APPROVED -
   * deducts the balance and enqueues an attendance recompute for the leave's date range.
   * act() only ever reaches here from a PENDING approval (checked above), so REJECTED/
   * CANCELLED can never follow an APPROVED one through this path: nothing was deducted yet,
   * so there is nothing to reverse.
   */
  private async applyLeaveDecision(
    tx: Prisma.TransactionClient,
    tenantId: string,
    leaveRequestId: string,
    nextStatus: ApprovalStatus,
    actorSubject: string,
  ): Promise<void> {
    const leaveRequest = await tx.leaveRequest.findFirstOrThrow({
      where: { id: leaveRequestId, tenantId },
    });
    await tx.leaveRequest.update({
      where: { id: leaveRequestId },
      data: { status: nextStatus, decidedAt: new Date() },
    });
    if (nextStatus !== 'APPROVED') return;

    const balance = await tx.leaveBalance.findFirst({
      where: {
        tenantId,
        employeeId: leaveRequest.employeeId,
        leaveTypeId: leaveRequest.leaveTypeId,
        year: leaveRequest.startDate.getUTCFullYear(),
      },
    });
    if (balance) {
      const available = balance.allocatedDays.minus(balance.usedDays);
      if (available.lessThan(leaveRequest.totalDays)) {
        throw new ConflictException(
          'Insufficient leave balance remaining to approve this request',
        );
      }
      await tx.leaveBalance.update({
        where: { id: balance.id },
        data: { usedDays: { increment: leaveRequest.totalDays } },
      });
    }

    await this.enqueueEmployeeRecompute(
      tx,
      tenantId,
      leaveRequest.employeeId,
      leaveRequest.startDate,
      leaveRequest.endDate,
      'LEAVE_APPROVED',
      actorSubject,
    );
  }

  /**
   * Keeps OnDutyRequest.status in sync with its ApprovalRequest, and - only on APPROVED -
   * enqueues an attendance recompute for its date range so recomputeDay suppresses
   * MISSING_PUNCH/ABSENCE and reports ON_DUTY for days with no punch evidence. No balance
   * involved, unlike leave - on-duty doesn't deplete an allocation.
   */
  private async applyOnDutyDecision(
    tx: Prisma.TransactionClient,
    tenantId: string,
    onDutyRequestId: string,
    nextStatus: ApprovalStatus,
    actorSubject: string,
  ): Promise<void> {
    const onDutyRequest = await tx.onDutyRequest.findFirstOrThrow({
      where: { id: onDutyRequestId, tenantId },
    });
    await tx.onDutyRequest.update({
      where: { id: onDutyRequestId },
      data: { status: nextStatus, decidedAt: new Date() },
    });
    if (nextStatus !== 'APPROVED') return;

    await this.enqueueEmployeeRecompute(
      tx,
      tenantId,
      onDutyRequest.employeeId,
      onDutyRequest.startDate,
      onDutyRequest.endDate,
      'ON_DUTY_APPROVED',
      actorSubject,
    );
  }

  /**
   * Keeps CompOffCredit.status in sync with its ApprovalRequest, and - only on APPROVED -
   * sets expiresAt and deposits creditDays into the tenant's isCompOff LeaveType balance
   * (upserting the LeaveBalance row if none exists yet for that employee/year). No attendance
   * recompute here - unlike leave/on-duty, approving a credit doesn't change any AttendanceDay,
   * it only makes a balance spendable via the normal LeaveRequest flow. Requires exactly one
   * active LeaveType with isCompOff=true to exist; HR configures that once via the Leave
   * Types screen, same as any other leave type.
   */
  private async applyCompOffDecision(
    tx: Prisma.TransactionClient,
    tenantId: string,
    compOffCreditId: string,
    nextStatus: ApprovalStatus,
    actorSubject: string,
  ): Promise<void> {
    const credit = await tx.compOffCredit.findFirstOrThrow({
      where: { id: compOffCreditId, tenantId },
    });
    const expiresAt =
      nextStatus === 'APPROVED'
        ? new Date(credit.workedDate.getTime() + COMP_OFF_EXPIRY_DAYS * MS_PER_DAY)
        : credit.expiresAt;
    await tx.compOffCredit.update({
      where: { id: compOffCreditId },
      data: { status: nextStatus, decidedAt: new Date(), expiresAt },
    });
    if (nextStatus !== 'APPROVED') return;

    const compOffType = await tx.leaveType.findFirst({
      where: { tenantId, isCompOff: true, active: true },
    });
    if (!compOffType) {
      throw new ConflictException(
        'No active comp-off leave type is configured for this tenant; ask an admin to mark one in Leave Types before approving',
      );
    }
    const year = credit.workedDate.getUTCFullYear();
    const balance = await tx.leaveBalance.findFirst({
      where: { tenantId, employeeId: credit.employeeId, leaveTypeId: compOffType.id, year },
    });
    if (balance) {
      await tx.leaveBalance.update({
        where: { id: balance.id },
        data: { allocatedDays: { increment: credit.creditDays } },
      });
    } else {
      await tx.leaveBalance.create({
        data: {
          tenantId,
          employeeId: credit.employeeId,
          leaveTypeId: compOffType.id,
          year,
          allocatedDays: credit.creditDays,
        },
      });
    }
    await tx.auditEvent.create({
      data: {
        tenantId,
        actorSubject,
        action: 'comp_off_credit.balance_deposited',
        entityType: 'LeaveBalance',
        entityId: balance?.id ?? credit.id,
        metadata: {
          compOffCreditId: credit.id,
          employeeId: credit.employeeId,
          leaveTypeId: compOffType.id,
          year,
          creditDays: credit.creditDays.toString(),
        },
      },
    });
  }

  private async enqueueEmployeeRecompute(
    tx: Prisma.TransactionClient,
    tenantId: string,
    employeeId: string,
    dateFrom: Date,
    dateTo: Date,
    reason: string,
    actorSubject: string,
  ): Promise<void> {
    const recomputeJob = await tx.policyRecomputeJob.create({
      data: {
        tenantId,
        scopeType: 'EMPLOYEE',
        scopeId: employeeId,
        dateFrom,
        dateTo,
        reason,
        requestedBy: actorSubject,
      },
    });
    const event = createEvent<AttendanceDayRecomputeRequestedEvent>(
      'attendance.day.recompute-requested.v1',
      {
        tenantId,
        recomputeJobId: recomputeJob.id,
        scopeType: 'EMPLOYEE',
        scopeId: employeeId,
        dateFrom: dateFrom.toISOString().slice(0, 10),
        dateTo: dateTo.toISOString().slice(0, 10),
        requestedBy: actorSubject,
        requestedAt: new Date().toISOString(),
      },
    );
    await enqueueOutboxEvent(tx, 'PolicyRecomputeJob', recomputeJob.id, event);
  }

  private assertActorCanAct(
    request: ApprovalRequest,
    subject: string,
    role: ApplicationRole,
    action: ApprovalActionType,
  ): void {
    if (action === 'CANCELLED' && request.requestedBy === subject) return;
    if (request.assigneeSubject && request.assigneeSubject !== subject) {
      throw new ForbiddenException(
        'This approval is assigned to another tenant member',
      );
    }
    if (
      !request.assigneeSubject &&
      request.assigneeRole &&
      request.assigneeRole !== role &&
      role !== 'TENANT_ADMIN' &&
      role !== 'HR_ADMIN'
    ) {
      throw new ForbiddenException(
        'Your tenant role is not assigned to this approval',
      );
    }
  }

  private validateTarget(dto: CreateApprovalDto): void {
    const valid =
      (dto.type === 'ATTENDANCE_PERIOD' &&
        dto.periodId &&
        !dto.exceptionId) ||
      (dto.type === 'EXCEPTION' && dto.exceptionId && !dto.periodId) ||
      (dto.type === 'PAYROLL_EXPORT' && dto.periodId && !dto.exceptionId);
    if (!valid) {
      throw new BadRequestException(
        'Approval type requires exactly one matching target',
      );
    }
  }

  private async ensureTargetBelongsToTenant(
    tenantId: string,
    dto: CreateApprovalDto,
  ): Promise<void> {
    const count = dto.exceptionId
      ? await this.prisma.attendanceException.count({
          where: { id: dto.exceptionId, tenantId },
        })
      : await this.prisma.processingPeriod.count({
          where: { id: dto.periodId, tenantId },
        });
    if (count !== 1) throw new NotFoundException('Approval target not found');
  }
}
