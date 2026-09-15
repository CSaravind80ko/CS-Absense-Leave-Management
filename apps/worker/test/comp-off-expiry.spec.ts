import { PrismaClient } from '@prisma/client';
import { CompOffExpiryService } from '../src/comp-off-expiry';

const tenantId = 'de305d54-75b4-431b-adb2-eb6b9e546014';
const employeeId = '8d11d74a-e6b1-4a4c-9104-59538a65f28d';
const creditId = 'c56a4180-65aa-42ec-a945-5fd21dec0538';

function decimal(value: number) {
  return {
    value,
    toString: () => String(value),
    minus: (other: { value: number }) => decimal(value - other.value),
    greaterThan: (n: number) => value > n,
    lessThan: (other: { value: number }) => value < other.value,
  };
}

describe('CompOffExpiryService.sweep', () => {
  it('does nothing when there are no expired approved credits', async () => {
    const prisma = {
      compOffCredit: { findMany: jest.fn().mockResolvedValue([]) },
    } as unknown as PrismaClient;
    const service = new CompOffExpiryService(prisma);

    await expect(service.sweep()).resolves.toBe(0);
  });

  it('marks a credit EXPIRED without touching the balance when no comp-off leave type is configured', async () => {
    const findFirstCredit = jest.fn().mockResolvedValue({ id: creditId, status: 'APPROVED' });
    const compOffUpdate = jest.fn().mockResolvedValue({});
    const auditCreate = jest.fn().mockResolvedValue({});
    const tx = {
      compOffCredit: { findFirst: findFirstCredit, update: compOffUpdate },
      leaveType: { findFirst: jest.fn().mockResolvedValue(null) },
      leaveBalance: { findFirst: jest.fn() },
      auditEvent: { create: auditCreate },
    };
    const prisma = {
      compOffCredit: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: creditId,
            tenantId,
            employeeId,
            workedDate: new Date('2026-06-01'),
            creditDays: decimal(1),
          },
        ]),
      },
      $transaction: jest.fn((callback: (tx: unknown) => unknown) => callback(tx)),
    } as unknown as PrismaClient;
    const service = new CompOffExpiryService(prisma);

    await expect(service.sweep()).resolves.toBe(1);
    expect(compOffUpdate).toHaveBeenCalledWith({
      where: { id: creditId },
      data: { status: 'EXPIRED' },
    });
    expect(auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'comp_off_credit.expired',
          metadata: expect.objectContaining({ clawedBackDays: null }),
        }),
      }),
    );
  });

  it('claws back only up to the balance headroom, never below what is already used', async () => {
    const balanceUpdate = jest.fn().mockResolvedValue({});
    const tx = {
      compOffCredit: {
        findFirst: jest.fn().mockResolvedValue({ id: creditId, status: 'APPROVED' }),
        update: jest.fn().mockResolvedValue({}),
      },
      leaveType: { findFirst: jest.fn().mockResolvedValue({ id: 'comp-off-type' }) },
      leaveBalance: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'balance-id',
          allocatedDays: decimal(1.5),
          usedDays: decimal(1),
        }),
        update: balanceUpdate,
      },
      auditEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      compOffCredit: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: creditId,
            tenantId,
            employeeId,
            workedDate: new Date('2026-06-01'),
            creditDays: decimal(1),
          },
        ]),
      },
      $transaction: jest.fn((callback: (tx: unknown) => unknown) => callback(tx)),
    } as unknown as PrismaClient;
    const service = new CompOffExpiryService(prisma);

    await service.sweep();

    // headroom = 1.5 - 1 = 0.5, credit was 1 day, so only 0.5 is clawed back
    expect(balanceUpdate).toHaveBeenCalledWith({
      where: { id: 'balance-id' },
      data: { allocatedDays: { decrement: expect.objectContaining({ value: 0.5 }) } },
    });
  });

  it('skips a credit that was already resolved by another process before the transaction ran', async () => {
    const compOffUpdate = jest.fn();
    const tx = {
      compOffCredit: { findFirst: jest.fn().mockResolvedValue(null), update: compOffUpdate },
    };
    const prisma = {
      compOffCredit: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: creditId,
            tenantId,
            employeeId,
            workedDate: new Date('2026-06-01'),
            creditDays: decimal(1),
          },
        ]),
      },
      $transaction: jest.fn((callback: (tx: unknown) => unknown) => callback(tx)),
    } as unknown as PrismaClient;
    const service = new CompOffExpiryService(prisma);

    await expect(service.sweep()).resolves.toBe(1);
    expect(compOffUpdate).not.toHaveBeenCalled();
  });
});
