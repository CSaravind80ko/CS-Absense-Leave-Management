import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ShiftsService } from '../src/shifts/shifts.service';
import { PrismaService } from '../src/prisma/prisma.service';

const tenantId = 'de305d54-75b4-431b-adb2-eb6b9e546014';
const shiftId = 'c56a4180-65aa-42ec-a945-5fd21dec0538';
const locationId = '11111111-1111-4111-8111-111111111111';

describe('ShiftsService.create', () => {
  it('rejects a locationId that does not belong to the tenant', async () => {
    const prisma = {
      location: { findFirst: jest.fn().mockResolvedValue(null) },
    } as unknown as PrismaService;
    const service = new ShiftsService(prisma);

    await expect(
      service.create(tenantId, 'actor', {
        name: 'General Shift',
        code: 'GEN',
        startMinutes: 540,
        endMinutes: 1080,
        locationId,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('maps a duplicate code (P2002) to ConflictException', async () => {
    const { Prisma } = await import('@prisma/client');
    const create = jest.fn().mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('unique constraint', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );
    const tx = { shift: { create }, auditEvent: { create: jest.fn() } };
    const prisma = {
      $transaction: jest.fn((callback: (tx: unknown) => unknown) => callback(tx)),
    } as unknown as PrismaService;
    const service = new ShiftsService(prisma);

    await expect(
      service.create(tenantId, 'actor', { name: 'General Shift', code: 'GEN', startMinutes: 540, endMinutes: 1080 }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('defaults breakMinutes/graceMinutes/crossesMidnight and nulls locationId when omitted', async () => {
    const create = jest.fn().mockResolvedValue({ id: shiftId });
    const tx = { shift: { create }, auditEvent: { create: jest.fn().mockResolvedValue({}) } };
    const prisma = {
      $transaction: jest.fn((callback: (tx: unknown) => unknown) => callback(tx)),
    } as unknown as PrismaService;
    const service = new ShiftsService(prisma);

    await service.create(tenantId, 'actor', {
      name: 'General Shift',
      code: 'GEN',
      startMinutes: 540,
      endMinutes: 1080,
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          breakMinutes: 0,
          graceMinutes: 0,
          crossesMidnight: false,
          locationId: null,
        }),
      }),
    );
  });
});

describe('ShiftsService.update', () => {
  it('throws NotFoundException for a shift outside the tenant', async () => {
    const prisma = {
      shift: { findFirst: jest.fn().mockResolvedValue(null) },
    } as unknown as PrismaService;
    const service = new ShiftsService(prisma);

    await expect(
      service.update(tenantId, shiftId, 'actor', {
        name: 'Renamed',
        startMinutes: 540,
        endMinutes: 1080,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('does not accept a code field even if present on the input object', async () => {
    // UpdateShiftDto has no `code` property, so nothing in the service ever reads dto.code;
    // this just documents the intent for future readers. Timing fields match `existing` so
    // this also exercises the no-recompute-needed path.
    const tx = {
      shift: { update: jest.fn().mockResolvedValue({ id: shiftId }) },
      auditEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      shift: {
        findFirst: jest.fn().mockResolvedValue({
          id: shiftId, tenantId, code: 'GEN',
          startMinutes: 540, endMinutes: 1080, breakMinutes: 0, graceMinutes: 0, crossesMidnight: false,
        }),
      },
      $transaction: jest.fn((callback: (tx: unknown) => unknown) => callback(tx)),
    } as unknown as PrismaService;
    const service = new ShiftsService(prisma);

    await service.update(tenantId, shiftId, 'actor', {
      name: 'Renamed',
      startMinutes: 540,
      endMinutes: 1080,
    });

    expect(tx.shift.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.not.objectContaining({ code: expect.anything() }) }),
    );
  });

  it('does not enqueue a recompute when only the name or location changes', async () => {
    const tx = {
      shift: { update: jest.fn().mockResolvedValue({ id: shiftId }) },
      auditEvent: { create: jest.fn().mockResolvedValue({}) },
      policyRecomputeJob: { create: jest.fn() },
    };
    const prisma = {
      shift: {
        findFirst: jest.fn().mockResolvedValue({
          id: shiftId, tenantId,
          startMinutes: 540, endMinutes: 1080, breakMinutes: 60, graceMinutes: 10, crossesMidnight: false,
        }),
      },
      location: { findFirst: jest.fn().mockResolvedValue({ id: locationId }) },
      $transaction: jest.fn((callback: (tx: unknown) => unknown) => callback(tx)),
    } as unknown as PrismaService;
    const service = new ShiftsService(prisma);

    await service.update(tenantId, shiftId, 'actor', {
      name: 'Renamed Shift',
      startMinutes: 540,
      endMinutes: 1080,
      breakMinutes: 60,
      graceMinutes: 10,
      crossesMidnight: false,
      locationId,
    });

    expect(tx.policyRecomputeJob.create).not.toHaveBeenCalled();
  });

  it('enqueues a SHIFT-scoped recompute job when a calculation-affecting field changes', async () => {
    const recomputeJobCreate = jest.fn().mockResolvedValue({ id: 'recompute-job-id' });
    const tx = {
      shift: { update: jest.fn().mockResolvedValue({ id: shiftId }) },
      auditEvent: { create: jest.fn().mockResolvedValue({}) },
      policyRecomputeJob: { create: recomputeJobCreate },
      outboxEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      shift: {
        findFirst: jest.fn().mockResolvedValue({
          id: shiftId, tenantId,
          startMinutes: 540, endMinutes: 1080, breakMinutes: 60, graceMinutes: 10, crossesMidnight: false,
        }),
      },
      $transaction: jest.fn((callback: (tx: unknown) => unknown) => callback(tx)),
    } as unknown as PrismaService;
    const service = new ShiftsService(prisma);

    await service.update(tenantId, shiftId, 'actor', {
      name: 'General Shift',
      startMinutes: 570, // moved 30 minutes later
      endMinutes: 1080,
      breakMinutes: 60,
      graceMinutes: 10,
      crossesMidnight: false,
    });

    expect(recomputeJobCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId,
          scopeType: 'SHIFT',
          scopeId: shiftId,
          reason: 'SHIFT_TIMING_CHANGED',
        }),
      }),
    );
  });
});

describe('ShiftsService.delete', () => {
  it('throws NotFoundException for a shift outside the tenant', async () => {
    const prisma = {
      shift: { findFirst: jest.fn().mockResolvedValue(null) },
    } as unknown as PrismaService;
    const service = new ShiftsService(prisma);

    await expect(service.delete(tenantId, shiftId, 'actor')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('reports how many employees are unassigned by the delete and recomputes each of them', async () => {
    const recomputeJobCreate = jest.fn().mockResolvedValue({ id: 'recompute-job-id' });
    const tx = {
      shift: { delete: jest.fn().mockResolvedValue({}) },
      auditEvent: { create: jest.fn().mockResolvedValue({}) },
      policyRecomputeJob: { create: recomputeJobCreate },
      outboxEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      shift: {
        findFirst: jest.fn().mockResolvedValue({ id: shiftId, tenantId, name: 'General Shift', code: 'GEN' }),
      },
      employee: {
        findMany: jest.fn().mockResolvedValue([{ id: 'emp-1' }, { id: 'emp-2' }]),
      },
      $transaction: jest.fn((callback: (tx: unknown) => unknown) => callback(tx)),
    } as unknown as PrismaService;
    const service = new ShiftsService(prisma);

    const result = await service.delete(tenantId, shiftId, 'actor');

    expect(result).toEqual({ unassignedEmployeeCount: 2 });
    expect(tx.auditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ metadata: { unassignedEmployeeCount: 2 } }),
      }),
    );
    // One EMPLOYEE-scoped job per affected employee, not a single SHIFT-scoped job - the
    // shift row (and its FK) is already gone by the time these jobs would run.
    expect(recomputeJobCreate).toHaveBeenCalledTimes(2);
    expect(recomputeJobCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ scopeType: 'EMPLOYEE', scopeId: 'emp-1', reason: 'SHIFT_DELETED' }),
      }),
    );
    expect(recomputeJobCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ scopeType: 'EMPLOYEE', scopeId: 'emp-2', reason: 'SHIFT_DELETED' }),
      }),
    );
  });

  it('enqueues no recompute jobs when no employees were assigned', async () => {
    const recomputeJobCreate = jest.fn();
    const tx = {
      shift: { delete: jest.fn().mockResolvedValue({}) },
      auditEvent: { create: jest.fn().mockResolvedValue({}) },
      policyRecomputeJob: { create: recomputeJobCreate },
    };
    const prisma = {
      shift: {
        findFirst: jest.fn().mockResolvedValue({ id: shiftId, tenantId, name: 'General Shift', code: 'GEN' }),
      },
      employee: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn((callback: (tx: unknown) => unknown) => callback(tx)),
    } as unknown as PrismaService;
    const service = new ShiftsService(prisma);

    const result = await service.delete(tenantId, shiftId, 'actor');

    expect(result).toEqual({ unassignedEmployeeCount: 0 });
    expect(recomputeJobCreate).not.toHaveBeenCalled();
  });
});
