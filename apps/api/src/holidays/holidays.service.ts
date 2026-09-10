import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Holiday, PolicyScopeType, Prisma } from '@prisma/client';
import { createEvent, type AttendanceDayRecomputeRequestedEvent } from '@attendance/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { enqueueOutboxEvent } from '../events/outbox';
import { CreateHolidayDto } from './dto/create-holiday.dto';
import { UpdateHolidayDto } from './dto/update-holiday.dto';
import { HolidayQueryDto } from './dto/holiday-query.dto';

@Injectable()
export class HolidaysService {
  constructor(private readonly prisma: PrismaService) {}

  list(tenantId: string, query: HolidayQueryDto): Promise<Holiday[]> {
    const where: Prisma.HolidayWhereInput = { tenantId };
    if (query.locationId) where.locationId = query.locationId;
    if (query.year) {
      where.date = { gte: new Date(`${query.year}-01-01`), lte: new Date(`${query.year}-12-31`) };
    }
    return this.prisma.holiday.findMany({ where, orderBy: { date: 'asc' } });
  }

  async get(tenantId: string, id: string): Promise<Holiday> {
    const holiday = await this.prisma.holiday.findFirst({ where: { id, tenantId } });
    if (!holiday) throw new NotFoundException('Holiday not found');
    return holiday;
  }

  async create(tenantId: string, actorSubject: string, dto: CreateHolidayDto): Promise<Holiday> {
    if (dto.locationId) await this.assertLocationInTenant(tenantId, dto.locationId);
    const date = new Date(dto.date);
    const locationId = dto.locationId ?? null;
    await this.assertNoDuplicate(tenantId, date, locationId);
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.holiday.create({
        data: { tenantId, name: dto.name, date, locationId },
      });
      await tx.auditEvent.create({
        data: {
          tenantId,
          actorSubject,
          action: 'holiday.created',
          entityType: 'Holiday',
          entityId: created.id,
          after: { name: created.name, date: dto.date, locationId },
        },
      });
      await this.enqueueRecompute(tx, tenantId, locationId, date, date, actorSubject, 'HOLIDAY_ADDED');
      return created;
    });
  }

  async update(
    tenantId: string,
    id: string,
    actorSubject: string,
    dto: UpdateHolidayDto,
  ): Promise<Holiday> {
    const existing = await this.prisma.holiday.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException('Holiday not found');
    if (dto.locationId) await this.assertLocationInTenant(tenantId, dto.locationId);
    const newDate = new Date(dto.date);
    const newLocationId = dto.locationId ?? null;
    const scopeChanged =
      newDate.getTime() !== existing.date.getTime() || newLocationId !== existing.locationId;
    if (scopeChanged) await this.assertNoDuplicate(tenantId, newDate, newLocationId, id);

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.holiday.update({
        where: { id },
        data: { name: dto.name, date: newDate, locationId: newLocationId },
      });
      await tx.auditEvent.create({
        data: {
          tenantId,
          actorSubject,
          action: 'holiday.updated',
          entityType: 'Holiday',
          entityId: id,
          before: {
            name: existing.name,
            date: existing.date.toISOString().slice(0, 10),
            locationId: existing.locationId,
          },
          after: { name: updated.name, date: dto.date, locationId: newLocationId },
        },
      });
      // Always recompute the old scope/date — its calculation trace still holds the old
      // holiday name. If the date or location actually moved, also recompute the new one.
      await this.enqueueRecompute(
        tx,
        tenantId,
        existing.locationId,
        existing.date,
        existing.date,
        actorSubject,
        'HOLIDAY_UPDATED',
      );
      if (scopeChanged) {
        await this.enqueueRecompute(
          tx,
          tenantId,
          newLocationId,
          newDate,
          newDate,
          actorSubject,
          'HOLIDAY_UPDATED',
        );
      }
      return updated;
    });
  }

  async delete(tenantId: string, id: string, actorSubject: string): Promise<void> {
    const existing = await this.prisma.holiday.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException('Holiday not found');
    await this.prisma.$transaction(async (tx) => {
      await tx.holiday.delete({ where: { id } });
      await tx.auditEvent.create({
        data: {
          tenantId,
          actorSubject,
          action: 'holiday.deleted',
          entityType: 'Holiday',
          entityId: id,
          before: {
            name: existing.name,
            date: existing.date.toISOString().slice(0, 10),
            locationId: existing.locationId,
          },
        },
      });
      await this.enqueueRecompute(
        tx,
        tenantId,
        existing.locationId,
        existing.date,
        existing.date,
        actorSubject,
        'HOLIDAY_DELETED',
      );
    });
  }

  private async assertLocationInTenant(tenantId: string, locationId: string): Promise<void> {
    const exists = await this.prisma.location.findFirst({
      where: { id: locationId, tenantId },
      select: { id: true },
    });
    if (!exists) throw new BadRequestException('locationId was not found for this tenant');
  }

  // No DB unique constraint backs this (Holiday has no @@unique), so it's a best-effort
  // application-level check, not a race-safe guarantee.
  private async assertNoDuplicate(
    tenantId: string,
    date: Date,
    locationId: string | null,
    excludeId?: string,
  ): Promise<void> {
    const duplicate = await this.prisma.holiday.findFirst({
      where: { tenantId, date, locationId, ...(excludeId ? { id: { not: excludeId } } : {}) },
      select: { id: true },
    });
    if (duplicate) {
      throw new ConflictException('A holiday already exists for this date and location');
    }
  }

  /**
   * A holiday only changes the day type for its own date, so the recompute window is a
   * single day — unlike a policy publish, which can cover a wide effective-date range.
   */
  private async enqueueRecompute(
    tx: Prisma.TransactionClient,
    tenantId: string,
    locationId: string | null,
    dateFrom: Date,
    dateTo: Date,
    actorSubject: string,
    reason: string,
  ): Promise<void> {
    const scopeType: PolicyScopeType = locationId ? 'LOCATION' : 'TENANT';
    const scopeId = locationId ?? tenantId;
    const recomputeJob = await tx.policyRecomputeJob.create({
      data: { tenantId, scopeType, scopeId, dateFrom, dateTo, reason, requestedBy: actorSubject },
    });
    const event = createEvent<AttendanceDayRecomputeRequestedEvent>(
      'attendance.day.recompute-requested.v1',
      {
        tenantId,
        recomputeJobId: recomputeJob.id,
        scopeType,
        scopeId,
        dateFrom: dateFrom.toISOString().slice(0, 10),
        dateTo: dateTo.toISOString().slice(0, 10),
        requestedBy: actorSubject,
        requestedAt: new Date().toISOString(),
      },
    );
    await enqueueOutboxEvent(tx, 'PolicyRecomputeJob', recomputeJob.id, event);
  }
}
