import { ApplicationRole, LeaveBalance } from '@prisma/client';
import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EmployeesService } from '../employees/employees.service';
import { SetLeaveBalanceDto } from './dto/set-leave-balance.dto';
import { LeaveBalanceQueryDto } from './dto/leave-balance-query.dto';

@Injectable()
export class LeaveBalancesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly employees: EmployeesService,
  ) {}

  async list(
    tenantId: string,
    subject: string,
    role: ApplicationRole,
    query: LeaveBalanceQueryDto,
  ): Promise<LeaveBalance[]> {
    const employeeId =
      role === 'EMPLOYEE'
        ? (await this.employees.getByCognitoSubject(tenantId, subject)).id
        : query.employeeId;
    return this.prisma.leaveBalance.findMany({
      where: {
        tenantId,
        employeeId,
        year: query.year ?? new Date().getFullYear(),
      },
      include: { leaveType: true },
      orderBy: { leaveType: { name: 'asc' } },
    });
  }

  // Upsert: HR grants or corrects one employee/type/year allocation. usedDays is untouched -
  // it only ever changes via ApprovalsService.act when a linked leave request is decided.
  async set(tenantId: string, actorSubject: string, dto: SetLeaveBalanceDto): Promise<LeaveBalance> {
    const [employeeExists, leaveTypeExists] = await Promise.all([
      this.prisma.employee.count({ where: { id: dto.employeeId, tenantId } }),
      this.prisma.leaveType.count({ where: { id: dto.leaveTypeId, tenantId } }),
    ]);
    if (!employeeExists) throw new BadRequestException('employeeId was not found for this tenant');
    if (!leaveTypeExists) throw new BadRequestException('leaveTypeId was not found for this tenant');

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.leaveBalance.findFirst({
        where: {
          tenantId,
          employeeId: dto.employeeId,
          leaveTypeId: dto.leaveTypeId,
          year: dto.year,
        },
      });
      const balance = await tx.leaveBalance.upsert({
        where: existing
          ? { id: existing.id }
          : {
              tenantId_employeeId_leaveTypeId_year: {
                tenantId,
                employeeId: dto.employeeId,
                leaveTypeId: dto.leaveTypeId,
                year: dto.year,
              },
            },
        create: {
          tenantId,
          employeeId: dto.employeeId,
          leaveTypeId: dto.leaveTypeId,
          year: dto.year,
          allocatedDays: dto.allocatedDays,
        },
        update: { allocatedDays: dto.allocatedDays },
      });
      await tx.auditEvent.create({
        data: {
          tenantId,
          actorSubject,
          action: existing ? 'leave_balance.updated' : 'leave_balance.granted',
          entityType: 'LeaveBalance',
          entityId: balance.id,
          before: existing ? { allocatedDays: existing.allocatedDays.toString() } : undefined,
          after: { allocatedDays: balance.allocatedDays.toString() },
          metadata: { employeeId: dto.employeeId, leaveTypeId: dto.leaveTypeId, year: dto.year },
        },
      });
      return balance;
    });
  }
}
