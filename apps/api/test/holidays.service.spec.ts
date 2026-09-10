import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { HolidaysService } from '../src/holidays/holidays.service';
import { PrismaService } from '../src/prisma/prisma.service';

const tenantId = 'de305d54-75b4-431b-adb2-eb6b9e546014';
const holidayId = 'c56a4180-65aa-42ec-a945-5fd21dec0538';
const locationId = '11111111-1111-4111-8111-111111111111';

describe('HolidaysService.create', () => {
  it('rejects a locationId that does not belong to the tenant', async () => {
    const prisma = {
      location: { findFirst: jest.fn().mockResolvedValue(null) },
    } as unknown as PrismaService;
    const service = new HolidaysService(prisma);

    await expect(
      service.create(tenantId, 'actor', { name: 'Founders Day', date: '2026-10-02', locationId }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a duplicate date/location combination', async () => {
    const prisma = {
      holiday: { findFirst: jest.fn().mockResolvedValue({ id: 'existing' }) },
    } as unknown as PrismaService;
    const service = new HolidaysService(prisma);

    await expect(
      service.create(tenantId, 'actor', { name: 'Founders Day', date: '2026-10-02' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('creates a tenant-wide holiday and enqueues a single-day TENANT-scoped recompute', async () => {
    const create = jest.fn().mockResolvedValue({ id: holidayId, locationId: null });
    const recomputeJobCreate = jest.fn().mockResolvedValue({ id: 'recompute-job-id' });
    const outboxCreate = jest.fn().mockResolvedValue({});
    const tx = {
      holiday: { create },
      auditEvent: { create: jest.fn().mockResolvedValue({}) },
      policyRecomputeJob: { create: recomputeJobCreate },
      outboxEvent: { create: outboxCreate },
    };
    const prisma = {
      holiday: { findFirst: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn((callback: (tx: unknown) => unknown) => callback(tx)),
    } as unknown as PrismaService;
    const service = new HolidaysService(prisma);

    await service.create(tenantId, 'actor', { name: 'Founders Day', date: '2026-10-02' });

    expect(recomputeJobCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId,
          scopeType: 'TENANT',
          scopeId: tenantId,
          reason: 'HOLIDAY_ADDED',
        }),
      }),
    );
    const [[jobArgs]] = recomputeJobCreate.mock.calls;
    expect(jobArgs.data.dateFrom).toEqual(jobArgs.data.dateTo);
    expect(outboxCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ eventType: 'attendance.day.recompute-requested.v1' }),
      }),
    );
  });

  it('scopes the recompute to LOCATION when a locationId is supplied', async () => {
    const create = jest.fn().mockResolvedValue({ id: holidayId, locationId });
    const recomputeJobCreate = jest.fn().mockResolvedValue({ id: 'recompute-job-id' });
    const tx = {
      holiday: { create },
      auditEvent: { create: jest.fn().mockResolvedValue({}) },
      policyRecomputeJob: { create: recomputeJobCreate },
      outboxEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      location: { findFirst: jest.fn().mockResolvedValue({ id: locationId }) },
      holiday: { findFirst: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn((callback: (tx: unknown) => unknown) => callback(tx)),
    } as unknown as PrismaService;
    const service = new HolidaysService(prisma);

    await service.create(tenantId, 'actor', { name: 'Regional Day', date: '2026-10-02', locationId });

    expect(recomputeJobCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ scopeType: 'LOCATION', scopeId: locationId }),
      }),
    );
  });
});

describe('HolidaysService.update', () => {
  function existingHoliday(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      id: holidayId,
      tenantId,
      name: 'Founders Day',
      date: new Date('2026-10-02'),
      locationId: null,
      ...overrides,
    };
  }

  it('throws NotFoundException for a holiday outside the tenant', async () => {
    const prisma = {
      holiday: { findFirst: jest.fn().mockResolvedValue(null) },
    } as unknown as PrismaService;
    const service = new HolidaysService(prisma);

    await expect(
      service.update(tenantId, holidayId, 'actor', { name: 'Renamed', date: '2026-10-02' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('enqueues only one recompute job when the date and location are unchanged', async () => {
    const recomputeJobCreate = jest.fn().mockResolvedValue({ id: 'recompute-job-id' });
    const tx = {
      holiday: { update: jest.fn().mockResolvedValue(existingHoliday({ name: 'Renamed' })) },
      auditEvent: { create: jest.fn().mockResolvedValue({}) },
      policyRecomputeJob: { create: recomputeJobCreate },
      outboxEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      holiday: { findFirst: jest.fn().mockResolvedValue(existingHoliday()) },
      $transaction: jest.fn((callback: (tx: unknown) => unknown) => callback(tx)),
    } as unknown as PrismaService;
    const service = new HolidaysService(prisma);

    await service.update(tenantId, holidayId, 'actor', { name: 'Renamed', date: '2026-10-02' });

    expect(recomputeJobCreate).toHaveBeenCalledTimes(1);
  });

  it('enqueues two recompute jobs (old date and new date) when the date moves', async () => {
    const recomputeJobCreate = jest.fn().mockResolvedValue({ id: 'recompute-job-id' });
    const tx = {
      holiday: { update: jest.fn().mockResolvedValue(existingHoliday({ date: new Date('2026-10-05') })) },
      auditEvent: { create: jest.fn().mockResolvedValue({}) },
      policyRecomputeJob: { create: recomputeJobCreate },
      outboxEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      holiday: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce(existingHoliday())
          .mockResolvedValueOnce(null),
      },
      $transaction: jest.fn((callback: (tx: unknown) => unknown) => callback(tx)),
    } as unknown as PrismaService;
    const service = new HolidaysService(prisma);

    await service.update(tenantId, holidayId, 'actor', { name: 'Founders Day', date: '2026-10-05' });

    expect(recomputeJobCreate).toHaveBeenCalledTimes(2);
    expect(recomputeJobCreate).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ data: expect.objectContaining({ dateFrom: new Date('2026-10-02') }) }),
    );
    expect(recomputeJobCreate).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ data: expect.objectContaining({ dateFrom: new Date('2026-10-05') }) }),
    );
  });

  it('rejects moving onto a date/location that already has a holiday', async () => {
    const prisma = {
      holiday: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce(existingHoliday())
          .mockResolvedValueOnce({ id: 'other-holiday' }),
      },
    } as unknown as PrismaService;
    const service = new HolidaysService(prisma);

    await expect(
      service.update(tenantId, holidayId, 'actor', { name: 'Founders Day', date: '2026-10-05' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('HolidaysService.delete', () => {
  it('throws NotFoundException for a holiday outside the tenant', async () => {
    const prisma = {
      holiday: { findFirst: jest.fn().mockResolvedValue(null) },
    } as unknown as PrismaService;
    const service = new HolidaysService(prisma);

    await expect(service.delete(tenantId, holidayId, 'actor')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('enqueues a recompute for the holiday date so the day reverts to a normal working day', async () => {
    const recomputeJobCreate = jest.fn().mockResolvedValue({ id: 'recompute-job-id' });
    const tx = {
      holiday: { delete: jest.fn().mockResolvedValue({}) },
      auditEvent: { create: jest.fn().mockResolvedValue({}) },
      policyRecomputeJob: { create: recomputeJobCreate },
      outboxEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      holiday: {
        findFirst: jest.fn().mockResolvedValue({
          id: holidayId,
          tenantId,
          name: 'Founders Day',
          date: new Date('2026-10-02'),
          locationId: null,
        }),
      },
      $transaction: jest.fn((callback: (tx: unknown) => unknown) => callback(tx)),
    } as unknown as PrismaService;
    const service = new HolidaysService(prisma);

    await service.delete(tenantId, holidayId, 'actor');

    expect(recomputeJobCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ reason: 'HOLIDAY_DELETED', scopeType: 'TENANT' }),
      }),
    );
  });
});
