import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { CompOffCreditsService } from '../src/comp-off-credits/comp-off-credits.service';
import { EmployeesService } from '../src/employees/employees.service';
import { PrismaService } from '../src/prisma/prisma.service';

const tenantId = 'de305d54-75b4-431b-adb2-eb6b9e546014';
const employeeId = '8d11d74a-e6b1-4a4c-9104-59538a65f28d';

function employees(id = employeeId) {
  return { getByCognitoSubject: jest.fn().mockResolvedValue({ id }) } as unknown as EmployeesService;
}

describe('CompOffCreditsService.submit', () => {
  it('rejects a date with no attendance record at all', async () => {
    const prisma = {
      attendanceDay: { findFirst: jest.fn().mockResolvedValue(null) },
    } as unknown as PrismaService;
    const service = new CompOffCreditsService(prisma, employees());

    await expect(
      service.submit(tenantId, 'actor', { workedDate: '2026-09-20' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a WORKING day (not a holiday/weekend)', async () => {
    const prisma = {
      attendanceDay: {
        findFirst: jest.fn().mockResolvedValue({ status: 'PRESENT', workedMinutes: 480 }),
      },
    } as unknown as PrismaService;
    const service = new CompOffCreditsService(prisma, employees());

    await expect(
      service.submit(tenantId, 'actor', { workedDate: '2026-09-20' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a holiday/weekend day with too little worked time', async () => {
    const prisma = {
      attendanceDay: {
        findFirst: jest.fn().mockResolvedValue({ status: 'WEEKEND', workedMinutes: 30 }),
      },
    } as unknown as PrismaService;
    const service = new CompOffCreditsService(prisma, employees());

    await expect(
      service.submit(tenantId, 'actor', { workedDate: '2026-09-20' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a date already claimed', async () => {
    const prisma = {
      attendanceDay: {
        findFirst: jest.fn().mockResolvedValue({ status: 'WEEKEND', workedMinutes: 300 }),
      },
      compOffCredit: { findFirst: jest.fn().mockResolvedValue({ id: 'existing' }) },
    } as unknown as PrismaService;
    const service = new CompOffCreditsService(prisma, employees());

    await expect(
      service.submit(tenantId, 'actor', { workedDate: '2026-09-20' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('credits a full day when worked minutes are at or above the full-day threshold', async () => {
    const creditCreate = jest.fn().mockResolvedValue({ id: 'credit-id', creditDays: { toString: () => '1' } });
    const tx = {
      compOffCredit: { create: creditCreate },
      approvalRequest: { create: jest.fn().mockResolvedValue({ id: 'approval-id' }) },
      approvalAction: { create: jest.fn().mockResolvedValue({}) },
      auditEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      attendanceDay: {
        findFirst: jest.fn().mockResolvedValue({ status: 'WEEKEND', workedMinutes: 402 }),
      },
      compOffCredit: { findFirst: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn((callback: (tx: unknown) => unknown) => callback(tx)),
    } as unknown as PrismaService;
    const service = new CompOffCreditsService(prisma, employees());

    await service.submit(tenantId, 'actor', { workedDate: '2026-09-20' });

    expect(creditCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ creditDays: 1, workedMinutes: 402 }) }),
    );
  });

  it('credits a half day when worked minutes are below the full-day threshold', async () => {
    const creditCreate = jest.fn().mockResolvedValue({ id: 'credit-id', creditDays: { toString: () => '0.5' } });
    const tx = {
      compOffCredit: { create: creditCreate },
      approvalRequest: { create: jest.fn().mockResolvedValue({ id: 'approval-id' }) },
      approvalAction: { create: jest.fn().mockResolvedValue({}) },
      auditEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      attendanceDay: {
        findFirst: jest.fn().mockResolvedValue({ status: 'HOLIDAY', workedMinutes: 120 }),
      },
      compOffCredit: { findFirst: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn((callback: (tx: unknown) => unknown) => callback(tx)),
    } as unknown as PrismaService;
    const service = new CompOffCreditsService(prisma, employees());

    await service.submit(tenantId, 'actor', { workedDate: '2026-09-20' });

    expect(creditCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ creditDays: 0.5 }) }),
    );
  });

  it('creates the CompOffCredit and a routing ApprovalRequest assigned to MANAGER together', async () => {
    const approvalCreate = jest.fn().mockResolvedValue({ id: 'approval-id' });
    const tx = {
      compOffCredit: {
        create: jest.fn().mockResolvedValue({ id: 'credit-id', creditDays: { toString: () => '1' } }),
      },
      approvalRequest: { create: approvalCreate },
      approvalAction: { create: jest.fn().mockResolvedValue({}) },
      auditEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      attendanceDay: {
        findFirst: jest.fn().mockResolvedValue({ status: 'WEEKEND', workedMinutes: 402 }),
      },
      compOffCredit: { findFirst: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn((callback: (tx: unknown) => unknown) => callback(tx)),
    } as unknown as PrismaService;
    const service = new CompOffCreditsService(prisma, employees());

    await service.submit(tenantId, 'actor', { workedDate: '2026-09-20', reason: 'Covered the weekend launch' });

    expect(approvalCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId,
          type: 'COMP_OFF',
          compOffCreditId: 'credit-id',
          requestedBy: 'actor',
          assigneeRole: 'MANAGER',
        }),
      }),
    );
  });
});

describe('CompOffCreditsService.listEligibleDays', () => {
  it('excludes worked off-days that already have a claim', async () => {
    const workDate1 = new Date('2026-09-06');
    const workDate2 = new Date('2026-09-13');
    const prisma = {
      attendanceDay: {
        findMany: jest.fn().mockResolvedValue([
          { workDate: workDate1, workedMinutes: 300, status: 'WEEKEND' },
          { workDate: workDate2, workedMinutes: 200, status: 'WEEKEND' },
        ]),
      },
      compOffCredit: {
        findMany: jest.fn().mockResolvedValue([{ workedDate: workDate1 }]),
      },
    } as unknown as PrismaService;
    const service = new CompOffCreditsService(prisma, employees());

    const result = await service.listEligibleDays(tenantId, 'actor');

    expect(result).toHaveLength(1);
    expect(result[0].workDate).toBe(workDate2);
  });

  it('returns an empty array without querying claims when there are no eligible days', async () => {
    const claimsFindMany = jest.fn();
    const prisma = {
      attendanceDay: { findMany: jest.fn().mockResolvedValue([]) },
      compOffCredit: { findMany: claimsFindMany },
    } as unknown as PrismaService;
    const service = new CompOffCreditsService(prisma, employees());

    const result = await service.listEligibleDays(tenantId, 'actor');

    expect(result).toEqual([]);
    expect(claimsFindMany).not.toHaveBeenCalled();
  });
});

describe('CompOffCreditsService.list', () => {
  it("forces the employeeId to the caller's own for an EMPLOYEE, ignoring the query param", async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = {
      $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
      compOffCredit: { findMany, count: jest.fn().mockResolvedValue(0) },
    } as unknown as PrismaService;
    const service = new CompOffCreditsService(prisma, employees());

    await service.list(tenantId, 'actor', 'EMPLOYEE', {
      page: 1, pageSize: 25, order: 'desc', employeeId: 'someone-else',
    });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ employeeId }) }),
    );
  });
});

describe('CompOffCreditsService.get', () => {
  it("hides another employee's claim from an EMPLOYEE caller as NotFoundException", async () => {
    const prisma = {
      compOffCredit: {
        findFirst: jest.fn().mockResolvedValue({ id: 'credit-id', tenantId, employeeId: 'other-employee' }),
      },
    } as unknown as PrismaService;
    const service = new CompOffCreditsService(prisma, employees());

    await expect(
      service.get(tenantId, 'actor', 'EMPLOYEE', 'credit-id'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
