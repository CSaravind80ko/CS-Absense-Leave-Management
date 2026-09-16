import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { AttendanceService } from '../src/attendance/attendance.service';
import { EmployeesService } from '../src/employees/employees.service';
import { PrismaService } from '../src/prisma/prisma.service';

const tenantId = 'de305d54-75b4-431b-adb2-eb6b9e546014';
const periodId = 'c56a4180-65aa-42ec-a945-5fd21dec0538';
const employeeId = '8d11d74a-e6b1-4a4c-9104-59538a65f28d';

function employees(id = employeeId) {
  return { getByCognitoSubject: jest.fn().mockResolvedValue({ id }) } as unknown as EmployeesService;
}

describe('AttendanceService', () => {
  it('rejects an inverted processing period before querying overlap', async () => {
    const count = jest.fn();
    const prisma = { processingPeriod: { count } } as unknown as PrismaService;
    const service = new AttendanceService(prisma, employees());

    await expect(
      service.createPeriod(tenantId, 'actor', {
        name: 'Invalid',
        startsOn: '2026-02-10',
        endsOn: '2026-02-01',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(count).not.toHaveBeenCalled();
  });

  it('scopes overlap checks to the tenant', async () => {
    const count = jest.fn().mockResolvedValue(1);
    const prisma = { processingPeriod: { count } } as unknown as PrismaService;
    const service = new AttendanceService(prisma, employees());

    await expect(
      service.createPeriod(tenantId, 'actor', {
        name: 'February',
        startsOn: '2026-02-01',
        endsOn: '2026-02-28',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(count).toHaveBeenCalledWith({
      where: expect.objectContaining({ tenantId }),
    });
  });

  it('does not reveal a period belonging to another tenant', async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    const prisma = {
      processingPeriod: { findFirst },
    } as unknown as PrismaService;
    const service = new AttendanceService(prisma, employees());

    await expect(service.getPeriod(tenantId, periodId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: periodId, tenantId } }),
    );
  });

  it('blocks approval while a critical exception remains open', async () => {
    const tx = {
      attendanceException: { count: jest.fn().mockResolvedValue(1) },
    };
    const prisma = {
      processingPeriod: {
        findFirst: jest.fn().mockResolvedValue({
          id: periodId,
          tenantId,
          status: 'REVIEW',
          version: 2,
        }),
      },
      $transaction: jest.fn((callback) => callback(tx)),
    } as unknown as PrismaService;
    const service = new AttendanceService(prisma, employees());

    await expect(
      service.updatePeriodStatus(tenantId, periodId, 'actor', {
        status: 'APPROVED',
        version: 2,
      }),
    ).rejects.toThrow('unresolved critical attendance blocker');
  });

  it('requires an audited reason when reopening', async () => {
    const prisma = {
      processingPeriod: {
        findFirst: jest.fn().mockResolvedValue({
          id: periodId,
          tenantId,
          status: 'APPROVED',
          version: 2,
        }),
      },
    } as unknown as PrismaService;
    const service = new AttendanceService(prisma, employees());

    await expect(
      service.updatePeriodStatus(tenantId, periodId, 'actor', {
        status: 'REVIEW',
        version: 2,
      }),
    ).rejects.toThrow('reason is required');
  });

  it('rejects a stale transition version', async () => {
    const tx = {
      processingPeriod: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    const prisma = {
      processingPeriod: {
        findFirst: jest.fn().mockResolvedValue({
          id: periodId,
          tenantId,
          status: 'PROCESSING',
          version: 3,
          lockedAt: null,
          reopenedAt: null,
          reopenReason: null,
        }),
      },
      $transaction: jest.fn((callback) => callback(tx)),
    } as unknown as PrismaService;
    const service = new AttendanceService(prisma, employees());

    await expect(
      service.updatePeriodStatus(tenantId, periodId, 'actor', {
        status: 'REVIEW',
        version: 2,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects reconciling a period that is not CLOSED', async () => {
    const prisma = {
      processingPeriod: {
        findFirst: jest.fn().mockResolvedValue({
          id: periodId,
          tenantId,
          status: 'EXPORTED',
          version: 4,
          reconciledAt: null,
        }),
      },
    } as unknown as PrismaService;
    const service = new AttendanceService(prisma, employees());

    await expect(
      service.reconcilePeriod(tenantId, periodId, 'actor', { version: 4 }),
    ).rejects.toThrow('must be CLOSED');
  });

  it('rejects reconciling a period that was already reconciled', async () => {
    const prisma = {
      processingPeriod: {
        findFirst: jest.fn().mockResolvedValue({
          id: periodId,
          tenantId,
          status: 'CLOSED',
          version: 5,
          reconciledAt: new Date('2026-09-01T00:00:00.000Z'),
        }),
      },
    } as unknown as PrismaService;
    const service = new AttendanceService(prisma, employees());

    await expect(
      service.reconcilePeriod(tenantId, periodId, 'actor', { version: 5 }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects a stale version when reconciling', async () => {
    const tx = {
      processingPeriod: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    const prisma = {
      processingPeriod: {
        findFirst: jest.fn().mockResolvedValue({
          id: periodId,
          tenantId,
          status: 'CLOSED',
          version: 6,
          reconciledAt: null,
        }),
      },
      $transaction: jest.fn((callback) => callback(tx)),
    } as unknown as PrismaService;
    const service = new AttendanceService(prisma, employees());

    await expect(
      service.reconcilePeriod(tenantId, periodId, 'actor', { version: 5 }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('records reconciliation with the actor, note, and audit trail', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const auditCreate = jest.fn().mockResolvedValue({});
    const findFirstOrThrow = jest
      .fn()
      .mockResolvedValue({ id: periodId, tenantId, status: 'CLOSED', version: 7 });
    const tx = {
      processingPeriod: { updateMany, findFirstOrThrow },
      auditEvent: { create: auditCreate },
    };
    const prisma = {
      processingPeriod: {
        findFirst: jest.fn().mockResolvedValue({
          id: periodId,
          tenantId,
          status: 'CLOSED',
          version: 6,
          reconciledAt: null,
        }),
      },
      $transaction: jest.fn((callback) => callback(tx)),
    } as unknown as PrismaService;
    const service = new AttendanceService(prisma, employees());

    await service.reconcilePeriod(tenantId, periodId, 'actor', {
      version: 6,
      note: 'Confirmed processed by finance',
    });

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: periodId, tenantId, version: 6, status: 'CLOSED' },
      data: expect.objectContaining({
        reconciledBy: 'actor',
        reconciliationNote: 'Confirmed processed by finance',
      }),
    });
    expect(auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'attendance.period.reconciled',
          entityType: 'ProcessingPeriod',
          entityId: periodId,
        }),
      }),
    );
  });

  it('requires a ready export for the current period version', async () => {
    const payrollCount = jest.fn().mockResolvedValue(0);
    const tx = {
      attendanceException: { count: jest.fn().mockResolvedValue(0) },
      payrollExport: { count: payrollCount },
    };
    const prisma = {
      processingPeriod: {
        findFirst: jest.fn().mockResolvedValue({
          id: periodId,
          tenantId,
          status: 'APPROVED',
          version: 8,
        }),
      },
      $transaction: jest.fn((callback) => callback(tx)),
    } as unknown as PrismaService;
    const service = new AttendanceService(prisma, employees());

    await expect(
      service.updatePeriodStatus(tenantId, periodId, 'actor', {
        status: 'EXPORTED',
        version: 8,
      }),
    ).rejects.toThrow('ready payroll export is required');
    expect(payrollCount).toHaveBeenCalledWith({
      where: {
        tenantId,
        periodId,
        periodVersion: 8,
        status: 'READY',
      },
    });
  });

  it('atomically retains the import request event in the outbox', async () => {
    const createdAt = new Date('2026-08-28T08:00:00.000Z');
    const job = {
      id: periodId,
      tenantId,
      periodId,
      requestedBy: 'actor',
      source: 'MANUAL_FILE',
      status: 'PENDING',
      createdAt,
    };
    const tx = {
      attendanceImportJob: { create: jest.fn().mockResolvedValue(job) },
      auditEvent: { create: jest.fn().mockResolvedValue({}) },
      outboxEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      processingPeriod: {
        findFirst: jest.fn().mockResolvedValue({
          id: periodId,
          tenantId,
          status: 'OPEN',
        }),
      },
      $transaction: jest.fn((callback) => callback(tx)),
    } as unknown as PrismaService;
    const result = await new AttendanceService(prisma, employees()).createImportJob(
      tenantId,
      'actor',
      { periodId, source: 'MANUAL_FILE' },
    );
    expect(result.workerConnected).toBe(true);
    expect(result.dispatch.payload).toEqual({
      tenantId,
      periodId,
      importJobId: periodId,
      source: 'MANUAL_FILE',
      requestedBy: 'actor',
      requestedAt: '2026-08-28T08:00:00.000Z',
    });
    expect(tx.outboxEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId,
        aggregateId: periodId,
        eventType: 'attendance.import.requested.v1',
      }),
    });
  });
});

describe('AttendanceService.myAttendance', () => {
  it('rejects a caller with no linked employee record', async () => {
    const prisma = {} as unknown as PrismaService;
    const unlinked = {
      getByCognitoSubject: jest.fn().mockRejectedValue(new NotFoundException()),
    } as unknown as EmployeesService;
    const service = new AttendanceService(prisma, unlinked);

    await expect(service.myAttendance(tenantId, 'actor', {})).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('throws when the tenant has no processing period yet and none was requested', async () => {
    const prisma = {
      processingPeriod: { findFirst: jest.fn().mockResolvedValue(null) },
    } as unknown as PrismaService;
    const service = new AttendanceService(prisma, employees());

    await expect(service.myAttendance(tenantId, 'actor', {})).rejects.toThrow(
      'No processing period exists yet',
    );
  });

  it('falls back to the most recent period when none is requested, and aggregates status totals', async () => {
    const prisma = {
      processingPeriod: {
        findFirst: jest.fn().mockResolvedValue({ id: periodId, tenantId, name: 'August' }),
      },
      $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
      attendanceDay: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'd1', status: 'PRESENT', scheduledMinutes: 480, workedMinutes: 480 },
          { id: 'd2', status: 'ABSENT', scheduledMinutes: 480, workedMinutes: 0 },
          { id: 'd3', status: 'LEAVE', scheduledMinutes: 0, workedMinutes: 0 },
          { id: 'd4', status: 'WEEKEND', scheduledMinutes: 0, workedMinutes: 0 },
        ]),
      },
      attendanceException: { count: jest.fn().mockResolvedValue(2) },
    } as unknown as PrismaService;
    const service = new AttendanceService(prisma, employees());

    const result = await service.myAttendance(tenantId, 'actor', {});

    expect(prisma.processingPeriod.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId }, orderBy: { startsOn: 'desc' } }),
    );
    expect(result.totals).toEqual(
      expect.objectContaining({
        present: 1,
        absent: 1,
        leave: 1,
        weekend: 1,
        workedMinutes: 480,
        scheduledMinutes: 960,
      }),
    );
    expect(result.openExceptionCount).toBe(2);
  });

  it('scopes attendance days to the caller\'s own employee id and the requested period', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = {
      processingPeriod: { findFirst: jest.fn().mockResolvedValue({ id: periodId, tenantId }) },
      $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
      attendanceDay: { findMany },
      attendanceException: { count: jest.fn().mockResolvedValue(0) },
    } as unknown as PrismaService;
    const service = new AttendanceService(prisma, employees('emp-self'));

    await service.myAttendance(tenantId, 'actor', { periodId });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId, employeeId: 'emp-self', periodId } }),
    );
  });
});
