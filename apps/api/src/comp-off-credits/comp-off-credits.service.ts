import { ApplicationRole, CompOffCredit, Prisma } from '@prisma/client';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PageResult, pageResult } from '../common/dto/page-query.dto';
import { PrismaService } from '../prisma/prisma.service';
import { EmployeesService } from '../employees/employees.service';
import { CreateCompOffCreditDto } from './dto/create-comp-off-credit.dto';
import { CompOffCreditQueryDto } from './dto/comp-off-credit-query.dto';

// A worked HOLIDAY/WEEKEND day needs at least this much punched time to be claimable at all,
// and at least this much to earn a full day's credit rather than half a day's.
const MIN_ELIGIBLE_MINUTES = 60;
const FULL_DAY_THRESHOLD_MINUTES = 240;
const ELIGIBLE_LOOKBACK_DAYS = 90;
const MS_PER_DAY = 86_400_000;

const COMP_OFF_CREDIT_INCLUDE = {
  employee: { select: { id: true, employeeNumber: true, firstName: true, lastName: true } },
  approvalRequests: { orderBy: { createdAt: 'desc' as const }, take: 1 },
};

@Injectable()
export class CompOffCreditsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly employees: EmployeesService,
  ) {}

  async list(
    tenantId: string,
    subject: string,
    role: ApplicationRole,
    query: CompOffCreditQueryDto,
  ): Promise<PageResult<CompOffCredit>> {
    const employeeId =
      role === 'EMPLOYEE'
        ? (await this.employees.getByCognitoSubject(tenantId, subject)).id
        : query.employeeId;
    const where: Prisma.CompOffCreditWhereInput = { tenantId, employeeId, status: query.status };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.compOffCredit.findMany({
        where,
        include: COMP_OFF_CREDIT_INCLUDE,
        orderBy: { createdAt: query.order },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.compOffCredit.count({ where }),
    ]);
    return pageResult(items, total, query);
  }

  async get(tenantId: string, subject: string, role: ApplicationRole, id: string) {
    const credit = await this.prisma.compOffCredit.findFirst({
      where: { id, tenantId },
      include: COMP_OFF_CREDIT_INCLUDE,
    });
    if (!credit) throw new NotFoundException('Comp-off credit not found');
    if (role === 'EMPLOYEE') {
      const employee = await this.employees.getByCognitoSubject(tenantId, subject);
      if (credit.employeeId !== employee.id) {
        throw new NotFoundException('Comp-off credit not found');
      }
    }
    return credit;
  }

  // Worked HOLIDAY/WEEKEND days in the lookback window that haven't already been claimed -
  // feeds the "eligible to claim" list in the UI.
  async listEligibleDays(tenantId: string, subject: string) {
    const employee = await this.employees.getByCognitoSubject(tenantId, subject);
    const lookbackStart = new Date(Date.now() - ELIGIBLE_LOOKBACK_DAYS * MS_PER_DAY);
    const days = await this.prisma.attendanceDay.findMany({
      where: {
        tenantId,
        employeeId: employee.id,
        status: { in: ['HOLIDAY', 'WEEKEND'] },
        workedMinutes: { gte: MIN_ELIGIBLE_MINUTES },
        workDate: { gte: lookbackStart },
      },
      orderBy: { workDate: 'desc' },
      select: { workDate: true, workedMinutes: true, status: true },
    });
    if (days.length === 0) return [];
    const claimed = await this.prisma.compOffCredit.findMany({
      where: { tenantId, employeeId: employee.id, workedDate: { in: days.map((day) => day.workDate) } },
      select: { workedDate: true },
    });
    const claimedDates = new Set(claimed.map((credit) => credit.workedDate.toISOString()));
    return days.filter((day) => !claimedDates.has(day.workDate.toISOString()));
  }

  /**
   * Mirrors LeaveRequestsService/OnDutyRequestsService.submit's shape - self-service, creates
   * the routing ApprovalRequest/ApprovalAction/AuditEvent in the same transaction. The
   * eligibility check reads the real AttendanceDay the worker already computed, rather than
   * trusting the employee's own account of what they worked.
   */
  async submit(tenantId: string, subject: string, dto: CreateCompOffCreditDto): Promise<CompOffCredit> {
    const employee = await this.employees.getByCognitoSubject(tenantId, subject);
    const workedDate = new Date(dto.workedDate);

    const attendanceDay = await this.prisma.attendanceDay.findFirst({
      where: { tenantId, employeeId: employee.id, workDate: workedDate },
    });
    if (!attendanceDay) {
      throw new BadRequestException('No attendance record was found for this date');
    }
    if (attendanceDay.status !== 'HOLIDAY' && attendanceDay.status !== 'WEEKEND') {
      throw new BadRequestException(
        'Comp-off can only be claimed for a holiday or weekend day that was worked',
      );
    }
    if (attendanceDay.workedMinutes < MIN_ELIGIBLE_MINUTES) {
      throw new BadRequestException(
        `At least ${MIN_ELIGIBLE_MINUTES} worked minutes are required to claim comp-off for this day`,
      );
    }

    const existing = await this.prisma.compOffCredit.findFirst({
      where: { tenantId, employeeId: employee.id, workedDate },
    });
    if (existing) {
      throw new ConflictException('Comp-off has already been claimed for this date');
    }

    const creditDays = attendanceDay.workedMinutes >= FULL_DAY_THRESHOLD_MINUTES ? 1 : 0.5;

    try {
      return await this.prisma.$transaction(async (tx) => {
        const credit = await tx.compOffCredit.create({
          data: {
            tenantId,
            employeeId: employee.id,
            workedDate,
            workedMinutes: attendanceDay.workedMinutes,
            creditDays,
            reason: dto.reason?.trim() || null,
          },
        });
        const approval = await tx.approvalRequest.create({
          data: {
            tenantId,
            type: 'COMP_OFF',
            compOffCreditId: credit.id,
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
            action: 'comp_off_credit.submitted',
            entityType: 'CompOffCredit',
            entityId: credit.id,
            after: {
              workedDate: dto.workedDate,
              workedMinutes: attendanceDay.workedMinutes,
              creditDays: credit.creditDays.toString(),
            },
          },
        });
        return credit;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Comp-off has already been claimed for this date');
      }
      throw error;
    }
  }
}
