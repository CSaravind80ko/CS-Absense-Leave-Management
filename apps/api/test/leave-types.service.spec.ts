import { ConflictException, NotFoundException } from '@nestjs/common';
import { LeaveTypesService } from '../src/leave-types/leave-types.service';
import { PrismaService } from '../src/prisma/prisma.service';

const tenantId = 'de305d54-75b4-431b-adb2-eb6b9e546014';
const leaveTypeId = 'c56a4180-65aa-42ec-a945-5fd21dec0538';

describe('LeaveTypesService.list', () => {
  it('excludes inactive types by default', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = { leaveType: { findMany } } as unknown as PrismaService;
    const service = new LeaveTypesService(prisma);

    await service.list(tenantId);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId, active: true } }),
    );
  });

  it('includes inactive types when requested', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = { leaveType: { findMany } } as unknown as PrismaService;
    const service = new LeaveTypesService(prisma);

    await service.list(tenantId, true);

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId } }));
  });
});

describe('LeaveTypesService.create', () => {
  it('maps a duplicate code (P2002) to ConflictException', async () => {
    const { Prisma } = await import('@prisma/client');
    const create = jest.fn().mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('unique constraint', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );
    const tx = { leaveType: { create }, auditEvent: { create: jest.fn() } };
    const prisma = {
      $transaction: jest.fn((callback: (tx: unknown) => unknown) => callback(tx)),
    } as unknown as PrismaService;
    const service = new LeaveTypesService(prisma);

    await expect(
      service.create(tenantId, 'actor', { name: 'Casual Leave', code: 'CL' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('defaults paid to true and defaultAnnualDays to null when omitted', async () => {
    const create = jest.fn().mockResolvedValue({ id: leaveTypeId });
    const tx = { leaveType: { create }, auditEvent: { create: jest.fn().mockResolvedValue({}) } };
    const prisma = {
      $transaction: jest.fn((callback: (tx: unknown) => unknown) => callback(tx)),
    } as unknown as PrismaService;
    const service = new LeaveTypesService(prisma);

    await service.create(tenantId, 'actor', { name: 'Casual Leave', code: 'CL' });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ paid: true, defaultAnnualDays: null }),
      }),
    );
  });
});

describe('LeaveTypesService.update', () => {
  it('throws NotFoundException for a leave type outside the tenant', async () => {
    const prisma = {
      leaveType: { findFirst: jest.fn().mockResolvedValue(null) },
    } as unknown as PrismaService;
    const service = new LeaveTypesService(prisma);

    await expect(
      service.update(tenantId, leaveTypeId, 'actor', { name: 'Renamed' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('does not accept a code field even if present on the input object', async () => {
    const tx = {
      leaveType: { update: jest.fn().mockResolvedValue({ id: leaveTypeId }) },
      auditEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      leaveType: {
        findFirst: jest.fn().mockResolvedValue({
          id: leaveTypeId, tenantId, code: 'CL', paid: true, active: true,
        }),
      },
      $transaction: jest.fn((callback: (tx: unknown) => unknown) => callback(tx)),
    } as unknown as PrismaService;
    const service = new LeaveTypesService(prisma);

    await service.update(tenantId, leaveTypeId, 'actor', { name: 'Renamed' });

    expect(tx.leaveType.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.not.objectContaining({ code: expect.anything() }) }),
    );
  });
});
