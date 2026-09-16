import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ReportsService } from '../src/reports/reports.service';
import { PrismaService } from '../src/prisma/prisma.service';

const tenantId = 'de305d54-75b4-431b-adb2-eb6b9e546014';
const periodId = 'c56a4180-65aa-42ec-a945-5fd21dec0538';

function decimal(value: number) {
  return {
    value,
    toString: () => String(value),
    minus: (other: { value: number }) => decimal(value - other.value),
  };
}

describe('ReportsService.attendanceSummaryByDepartment', () => {
  it('rejects a period that does not belong to the tenant', async () => {
    const prisma = {
      processingPeriod: { findFirst: jest.fn().mockResolvedValue(null) },
    } as unknown as PrismaService;
    const service = new ReportsService(prisma);

    await expect(
      service.attendanceSummaryByDepartment(tenantId, periodId),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('buckets attendance days and open exceptions by department, grouping unassigned employees together', async () => {
    const prisma = {
      processingPeriod: {
        findFirst: jest.fn().mockResolvedValue({ id: periodId, tenantId }),
      },
      $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
      attendanceDay: {
        findMany: jest.fn().mockResolvedValue([
          {
            status: 'PRESENT',
            employeeId: 'emp-1',
            employee: { departmentId: 'dept-1', department: { name: 'Finance' } },
          },
          {
            status: 'ABSENT',
            employeeId: 'emp-2',
            employee: { departmentId: 'dept-1', department: { name: 'Finance' } },
          },
          {
            status: 'PRESENT',
            employeeId: 'emp-3',
            employee: { departmentId: null, department: null },
          },
        ]),
      },
      attendanceException: {
        findMany: jest.fn().mockResolvedValue([
          {
            employee: { departmentId: 'dept-1', department: { name: 'Finance' } },
          },
        ]),
      },
    } as unknown as PrismaService;
    const service = new ReportsService(prisma);

    const result = await service.attendanceSummaryByDepartment(tenantId, periodId);

    expect(result).toEqual([
      expect.objectContaining({
        departmentId: 'dept-1',
        departmentName: 'Finance',
        employeeCount: 2,
        present: 1,
        absent: 1,
        openExceptions: 1,
      }),
      expect.objectContaining({
        departmentId: null,
        departmentName: 'Unassigned',
        employeeCount: 1,
        present: 1,
        openExceptions: 0,
      }),
    ]);
  });
});

describe('ReportsService.exceptionTrends', () => {
  it('rejects an empty periodIds string', async () => {
    const prisma = {} as unknown as PrismaService;
    const service = new ReportsService(prisma);

    await expect(service.exceptionTrends(tenantId, '  ,  ')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects when a requested period does not resolve for the tenant', async () => {
    const prisma = {
      processingPeriod: { findMany: jest.fn().mockResolvedValue([]) },
    } as unknown as PrismaService;
    const service = new ReportsService(prisma);

    await expect(service.exceptionTrends(tenantId, periodId)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('counts exceptions per period by severity and type', async () => {
    const otherPeriodId = '8d11d74a-e6b1-4a4c-9104-59538a65f28d';
    const prisma = {
      processingPeriod: {
        findMany: jest.fn().mockResolvedValue([
          { id: periodId, name: 'August', startsOn: new Date('2026-08-01') },
          { id: otherPeriodId, name: 'September', startsOn: new Date('2026-09-01') },
        ]),
      },
      attendanceException: {
        findMany: jest.fn().mockResolvedValue([
          { type: 'LATE_ARRIVAL', severity: 'HIGH', attendanceDay: { periodId } },
          { type: 'LATE_ARRIVAL', severity: 'MEDIUM', attendanceDay: { periodId } },
          { type: 'MISSING_PUNCH', severity: 'CRITICAL', attendanceDay: { periodId: otherPeriodId } },
        ]),
      },
    } as unknown as PrismaService;
    const service = new ReportsService(prisma);

    const result = await service.exceptionTrends(tenantId, `${periodId},${otherPeriodId}`);

    expect(result).toEqual([
      {
        periodId,
        periodName: 'August',
        total: 2,
        critical: 0,
        high: 1,
        byType: { LATE_ARRIVAL: 2 },
      },
      {
        periodId: otherPeriodId,
        periodName: 'September',
        total: 1,
        critical: 1,
        high: 0,
        byType: { MISSING_PUNCH: 1 },
      },
    ]);
  });
});

describe('ReportsService.leaveUtilization', () => {
  it('joins balance totals with leave type metadata and computes remaining days', async () => {
    const prisma = {
      $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
      leaveBalance: {
        groupBy: jest.fn().mockResolvedValue([
          {
            leaveTypeId: 'type-1',
            _sum: { allocatedDays: decimal(12), usedDays: decimal(4) },
            _count: 3,
          },
        ]),
      },
      leaveType: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'type-1', name: 'Earned Leave', isCompOff: false, paid: true },
        ]),
      },
    } as unknown as PrismaService;
    const service = new ReportsService(prisma);

    const result = await service.leaveUtilization(tenantId, 2026);

    expect(result).toEqual([
      {
        leaveTypeId: 'type-1',
        name: 'Earned Leave',
        isCompOff: false,
        paid: true,
        employeeCount: 3,
        allocatedDays: '12',
        usedDays: '4',
        remainingDays: '8',
      },
    ]);
  });
});

describe('ReportsService.anomalyPatterns', () => {
  it('returns only OPEN RECURRING_PATTERN exceptions, unpacking their details', async () => {
    const findMany = jest.fn().mockResolvedValue([
      {
        id: 'exc-1',
        severity: 'HIGH',
        createdAt: new Date('2026-09-16T00:00:00.000Z'),
        details: { patternType: 'LATE_ARRIVAL', occurrenceCount: 5, windowDays: 14 },
        employee: {
          id: 'emp-1',
          employeeNumber: 'EMP-1',
          firstName: 'Ananya',
          lastName: 'Iyer',
          department: { id: 'dept-1', name: 'Finance' },
        },
      },
    ]);
    const prisma = {
      attendanceException: { findMany },
    } as unknown as PrismaService;
    const service = new ReportsService(prisma);

    const result = await service.anomalyPatterns(tenantId);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId, type: 'RECURRING_PATTERN', status: 'OPEN' },
      }),
    );
    expect(result).toEqual([
      expect.objectContaining({
        id: 'exc-1',
        patternType: 'LATE_ARRIVAL',
        occurrenceCount: 5,
        windowDays: 14,
        severity: 'HIGH',
      }),
    ]);
  });

  it('falls back sensibly when details is missing', async () => {
    const prisma = {
      attendanceException: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'exc-2', severity: 'HIGH', createdAt: new Date(), details: null, employee: null },
        ]),
      },
    } as unknown as PrismaService;
    const service = new ReportsService(prisma);

    const result = await service.anomalyPatterns(tenantId);

    expect(result).toEqual([
      expect.objectContaining({ patternType: 'OTHER', occurrenceCount: 0, windowDays: 0 }),
    ]);
  });
});
