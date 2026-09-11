import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Shift } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateShiftDto } from './dto/create-shift.dto';
import { UpdateShiftDto } from './dto/update-shift.dto';

/**
 * Shift timing (startMinutes/endMinutes/breakMinutes/graceMinutes) feeds directly into the
 * worker's scheduled-minutes/late/overtime calculation, the same way a policy rule does -
 * but unlike a policy publish or holiday change, creating/editing/deleting a shift here does
 * NOT enqueue a PolicyRecomputeJob. PolicyScopeType (TENANT/LOCATION/DEPARTMENT/
 * EMPLOYEE_GROUP/EMPLOYEE) has no SHIFT case, so there's no scope the worker's recompute
 * handler could resolve to "every employee on this shift" without a schema change. Already-
 * computed AttendanceDay rows for affected employees stay stale until an unrelated recompute
 * (a policy publish, a holiday change) happens to cover them.
 */
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
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.shift.update({
        where: { id },
        data: {
          name: dto.name,
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
      return updated;
    });
  }

  // Employee.shiftId is onDelete: SetNull, so deleting a shift silently unassigns whoever had
  // it. Report the count back so the caller/UI can warn about it rather than surprise anyone.
  async delete(
    tenantId: string,
    id: string,
    actorSubject: string,
  ): Promise<{ unassignedEmployeeCount: number }> {
    const existing = await this.prisma.shift.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException('Shift not found');
    const unassignedEmployeeCount = await this.prisma.employee.count({
      where: { tenantId, shiftId: id },
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
          metadata: { unassignedEmployeeCount },
        },
      });
    });
    return { unassignedEmployeeCount };
  }

  private async assertLocationInTenant(tenantId: string, locationId: string): Promise<void> {
    const exists = await this.prisma.location.findFirst({
      where: { id: locationId, tenantId },
      select: { id: true },
    });
    if (!exists) throw new BadRequestException('locationId was not found for this tenant');
  }
}
