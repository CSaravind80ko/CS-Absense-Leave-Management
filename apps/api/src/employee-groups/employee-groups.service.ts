import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { EmployeeGroup, Prisma } from '@prisma/client';
import {
  createEvent,
  type AttendanceDayRecomputeRequestedEvent,
} from '@attendance/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { enqueueOutboxEvent } from '../events/outbox';
import { CreateEmployeeGroupDto } from './dto/create-employee-group.dto';
import { UpdateEmployeeGroupDto } from './dto/update-employee-group.dto';
import { AddGroupMemberDto } from './dto/add-group-member.dto';

const MS_PER_DAY = 86_400_000;

@Injectable()
export class EmployeeGroupsService {
  constructor(private readonly prisma: PrismaService) {}

  list(tenantId: string): Promise<EmployeeGroup[]> {
    return this.prisma.employeeGroup.findMany({
      where: { tenantId },
      orderBy: { name: 'asc' },
    });
  }

  async get(tenantId: string, id: string) {
    const group = await this.prisma.employeeGroup.findFirst({
      where: { id, tenantId },
      include: {
        members: {
          include: {
            employee: {
              select: { id: true, employeeNumber: true, firstName: true, lastName: true },
            },
          },
        },
      },
    });
    if (!group) throw new NotFoundException('Employee group not found');
    return group;
  }

  async create(
    tenantId: string,
    actorSubject: string,
    dto: CreateEmployeeGroupDto,
  ): Promise<EmployeeGroup> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const created = await tx.employeeGroup.create({
          data: {
            tenantId,
            name: dto.name,
            code: dto.code,
            priority: dto.priority ?? 0,
          },
        });
        await tx.auditEvent.create({
          data: {
            tenantId,
            actorSubject,
            action: 'employee_group.created',
            entityType: 'EmployeeGroup',
            entityId: created.id,
            after: { name: created.name, code: created.code, priority: created.priority },
          },
        });
        return created;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('An employee group with this code already exists');
      }
      throw error;
    }
  }

  async update(
    tenantId: string,
    id: string,
    actorSubject: string,
    dto: UpdateEmployeeGroupDto,
  ): Promise<EmployeeGroup> {
    const group = await this.prisma.employeeGroup.findFirst({ where: { id, tenantId } });
    if (!group) throw new NotFoundException('Employee group not found');
    const priorityChanged = dto.priority !== undefined && dto.priority !== group.priority;
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.employeeGroup.update({
        where: { id },
        data: { name: dto.name, priority: dto.priority },
      });
      await tx.auditEvent.create({
        data: {
          tenantId,
          actorSubject,
          action: 'employee_group.updated',
          entityType: 'EmployeeGroup',
          entityId: id,
          before: { name: group.name, priority: group.priority },
          after: { name: updated.name, priority: updated.priority },
        },
      });
      if (priorityChanged) {
        // A priority change can shift precedence for every member of this group, so the
        // recompute is scoped to the group itself rather than a single employee.
        await this.enqueueRecompute(
          tx,
          tenantId,
          'EMPLOYEE_GROUP',
          id,
          actorSubject,
          'GROUP_PRIORITY_CHANGED',
        );
      }
      return updated;
    });
  }

  async addMember(
    tenantId: string,
    id: string,
    actorSubject: string,
    dto: AddGroupMemberDto,
  ): Promise<void> {
    const group = await this.prisma.employeeGroup.findFirst({ where: { id, tenantId } });
    if (!group) throw new NotFoundException('Employee group not found');
    const employee = await this.prisma.employee.findFirst({
      where: { id: dto.employeeId, tenantId },
    });
    if (!employee) throw new NotFoundException('Employee not found');
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.employeeGroupMember.create({
          data: { tenantId, groupId: id, employeeId: dto.employeeId },
        });
        await tx.auditEvent.create({
          data: {
            tenantId,
            actorSubject,
            action: 'employee_group.member_added',
            entityType: 'EmployeeGroup',
            entityId: id,
            metadata: { employeeId: dto.employeeId },
          },
        });
        // Only this employee's resolution could have changed, not the whole group.
        await this.enqueueRecompute(
          tx,
          tenantId,
          'EMPLOYEE',
          dto.employeeId,
          actorSubject,
          'GROUP_MEMBERSHIP_CHANGED',
        );
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Employee is already a member of this group');
      }
      throw error;
    }
  }

  async removeMember(
    tenantId: string,
    id: string,
    employeeId: string,
    actorSubject: string,
  ): Promise<void> {
    const group = await this.prisma.employeeGroup.findFirst({ where: { id, tenantId } });
    if (!group) throw new NotFoundException('Employee group not found');
    await this.prisma.$transaction(async (tx) => {
      const deleted = await tx.employeeGroupMember.deleteMany({
        where: { tenantId, groupId: id, employeeId },
      });
      if (!deleted.count) {
        throw new NotFoundException('Employee is not a member of this group');
      }
      await tx.auditEvent.create({
        data: {
          tenantId,
          actorSubject,
          action: 'employee_group.member_removed',
          entityType: 'EmployeeGroup',
          entityId: id,
          metadata: { employeeId },
        },
      });
      await this.enqueueRecompute(
        tx,
        tenantId,
        'EMPLOYEE',
        employeeId,
        actorSubject,
        'GROUP_MEMBERSHIP_CHANGED',
      );
    });
  }

  private async enqueueRecompute(
    tx: Prisma.TransactionClient,
    tenantId: string,
    scopeType: 'EMPLOYEE' | 'EMPLOYEE_GROUP',
    scopeId: string,
    actorSubject: string,
    reason: string,
  ): Promise<void> {
    // Group membership has no effective-dating in this slice, so recompute is bounded to a
    // recent lookback window rather than the employee's entire attendance history.
    const lookbackDays = Number(
      process.env.POLICY_RECOMPUTE_MEMBERSHIP_LOOKBACK_DAYS ?? 60,
    );
    const today = new Date(new Date().toISOString().slice(0, 10));
    const dateFrom = new Date(today.getTime() - lookbackDays * MS_PER_DAY);
    const recomputeJob = await tx.policyRecomputeJob.create({
      data: {
        tenantId,
        scopeType,
        scopeId,
        dateFrom,
        dateTo: today,
        reason,
        requestedBy: actorSubject,
      },
    });
    const event = createEvent<AttendanceDayRecomputeRequestedEvent>(
      'attendance.day.recompute-requested.v1',
      {
        tenantId,
        recomputeJobId: recomputeJob.id,
        scopeType,
        scopeId,
        dateFrom: dateFrom.toISOString().slice(0, 10),
        dateTo: today.toISOString().slice(0, 10),
        requestedBy: actorSubject,
        requestedAt: new Date().toISOString(),
      },
    );
    await enqueueOutboxEvent(tx, 'PolicyRecomputeJob', recomputeJob.id, event);
  }
}
