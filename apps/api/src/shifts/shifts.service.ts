import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Shift } from '@prisma/client';
import {
  createEvent,
  type AttendanceDayRecomputeRequestedEvent,
} from '@attendance/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { enqueueOutboxEvent } from '../events/outbox';
import { CreateShiftDto } from './dto/create-shift.dto';
import { UpdateShiftDto } from './dto/update-shift.dto';

const MS_PER_DAY = 86_400_000;

@Injectable()
export class ShiftsService {
  constructor(private readonly prisma: PrismaService) {}

  list(tenantId: string): Promise<Shift[]> {
    return this.prisma.shift.findMany({ where: { tenantId }, orderBy: { name: 'asc' } });
  }

  async get(tenantId: string, id: string): Promise<Shift> {
    const shift = await this.prisma.shift.findFirst({ where: { id, tenantId } });
    if (!shift) throw new NotFoundException('Shift not found');
    return shift;
  }

  async create(tenantId: string, actorSubject: string, dto: CreateShiftDto): Promise<Shift> {
    if (dto.locationId) await this.assertLocationInTenant(tenantId, dto.locationId);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const created = await tx.shift.create({
          data: {
            tenantId,
            name: dto.name,
            code: dto.code,
            startMinutes: dto.startMinutes,
            endMinutes: dto.endMinutes,
            breakMinutes: dto.breakMinutes ?? 0,
            graceMinutes: dto.graceMinutes ?? 0,
            crossesMidnight: dto.crossesMidnight ?? false,
            locationId: dto.locationId ?? null,
          },
        });
        await tx.auditEvent.create({
          data: {
            tenantId,
            actorSubject,
            action: 'shift.created',
            entityType: 'Shift',
            entityId: created.id,
            after: {
              name: created.name,
              code: created.code,
              startMinutes: created.startMinutes,
              endMinutes: created.endMinutes,
            },
          },
        });
        // A brand-new shift starts with zero employees assigned (assignment happens via the
        // employee record), so there's nothing to recompute yet.
        return created;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('A shift with this code already exists');
      }
      throw error;
    }
  }

  async update(
    tenantId: string,
    id: string,
    actorSubject: string,
    dto: UpdateShiftDto,
  ): Promise<Shift> {
    const existing = await this.prisma.shift.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException('Shift not found');
    if (dto.locationId) await this.assertLocationInTenant(tenantId, dto.locationId);
    const breakMinutes = dto.breakMinutes ?? 0;
    const graceMinutes = dto.graceMinutes ?? 0;
    const crossesMidnight = dto.crossesMidnight ?? false;
    const calculationChanged =
      dto.startMinutes !== existing.startMinutes ||
      dto.endMinutes !== existing.endMinutes ||
      breakMinutes !== existing.breakMinutes ||
      graceMinutes !== existing.graceMinutes ||
      crossesMidnight !== existing.crossesMidnight;

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.shift.update({
        where: { id },
        data: {
          name: dto.name,
          startMinutes: dto.startMinutes,
          endMinutes: dto.endMinutes,
          breakMinutes,
          graceMinutes,
          crossesMidnight,
          locationId: dto.locationId ?? null,
        },
      });
      await tx.auditEvent.create({
        data: {
          tenantId,
          actorSubject,
          action: 'shift.updated',
          entityType: 'Shift',
          entityId: id,
          before: {
            startMinutes: existing.startMinutes,
            endMinutes: existing.endMinutes,
            breakMinutes: existing.breakMinutes,
            graceMinutes: existing.graceMinutes,
          },
          after: {
            startMinutes: updated.startMinutes,
            endMinutes: updated.endMinutes,
            breakMinutes: updated.breakMinutes,
            graceMinutes: updated.graceMinutes,
          },
        },
      });
      // Only enqueue when a field the worker actually reads for calculation changed - a
      // rename or a location move alone shouldn't trigger a recompute of every member's
      // attendance history.
      if (calculationChanged) {
        await this.enqueueRecompute(tx, tenantId, 'SHIFT', id, actorSubject, 'SHIFT_TIMING_CHANGED');
      }
      return updated;
    });
  }

  // Employee.shiftId is onDelete: SetNull, so deleting a shift silently unassigns whoever had
  // it. Report the count back so the caller/UI can warn about it rather than surprise anyone.
  // The affected employees are captured *before* the delete, because once shiftId is nulled a
  // SHIFT-scoped recompute job would resolve to nobody - each gets its own EMPLOYEE-scoped
  // job instead, the same convention EmployeeGroupsService uses for membership changes.
  async delete(
    tenantId: string,
    id: string,
    actorSubject: string,
  ): Promise<{ unassignedEmployeeCount: number }> {
    const existing = await this.prisma.shift.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException('Shift not found');
    const assignedEmployees = await this.prisma.employee.findMany({
      where: { tenantId, shiftId: id },
      select: { id: true },
    });
    await this.prisma.$transaction(async (tx) => {
      await tx.shift.delete({ where: { id } });
      await tx.auditEvent.create({
        data: {
          tenantId,
          actorSubject,
          action: 'shift.deleted',
          entityType: 'Shift',
          entityId: id,
          before: { name: existing.name, code: existing.code },
          metadata: { unassignedEmployeeCount: assignedEmployees.length },
        },
      });
      for (const employee of assignedEmployees) {
        await this.enqueueRecompute(
          tx,
          tenantId,
          'EMPLOYEE',
          employee.id,
          actorSubject,
          'SHIFT_DELETED',
        );
      }
    });
    return { unassignedEmployeeCount: assignedEmployees.length };
  }

  private async assertLocationInTenant(tenantId: string, locationId: string): Promise<void> {
    const exists = await this.prisma.location.findFirst({
      where: { id: locationId, tenantId },
      select: { id: true },
    });
    if (!exists) throw new BadRequestException('locationId was not found for this tenant');
  }

  // Shift assignment has no effective-dating, the same situation EmployeeGroupsService is in
  // for group membership, so this bounds the recompute to a recent lookback window rather
  // than the employee's entire attendance history.
  private async enqueueRecompute(
    tx: Prisma.TransactionClient,
    tenantId: string,
    scopeType: 'SHIFT' | 'EMPLOYEE',
    scopeId: string,
    actorSubject: string,
    reason: string,
  ): Promise<void> {
    const lookbackDays = Number(process.env.POLICY_RECOMPUTE_SHIFT_LOOKBACK_DAYS ?? 60);
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
