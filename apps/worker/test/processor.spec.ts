import type { PrismaClient } from '@prisma/client';
import type { S3Client } from '@aws-sdk/client-s3';
import { createEvent, type AttendanceDayRecomputeRequestedEvent } from '@attendance/contracts';
import { AttendanceEventProcessor } from '../src/processor';
import { resolveEffectivePolicy } from '../src/policy-resolution';
import type { WorkerConfig } from '../src/config';

jest.mock('../src/policy-resolution', () => ({
  resolveEffectivePolicy: jest.fn(),
}));

const mockResolveEffectivePolicy = resolveEffectivePolicy as jest.MockedFunction<
  typeof resolveEffectivePolicy
>;

const tenantId = 'de305d54-75b4-431b-adb2-eb6b9e546014';
const recomputeJobId = 'c56a4180-65aa-42ec-a945-5fd21dec0538';

const config: WorkerConfig = {
  queueUrl: 'queue',
  importBucket: 'imports',
  exportBucket: 'exports',
  concurrency: 1,
  visibilitySeconds: 60,
  maxRows: 1000,
  maxColumns: 20,
  maxCellBytes: 1024,
  maxArchiveBytes: 1024,
  maxArchiveRatio: 100,
};

function makeEvent(
  overrides: Partial<AttendanceDayRecomputeRequestedEvent> = {},
): AttendanceDayRecomputeRequestedEvent {
  return createEvent<AttendanceDayRecomputeRequestedEvent>(
    'attendance.day.recompute-requested.v1',
    {
      tenantId,
      recomputeJobId,
      scopeType: 'TENANT',
      scopeId: tenantId,
      dateFrom: '2026-08-01',
      dateTo: '2026-08-31',
      requestedBy: 'tenant-admin@example.com',
      requestedAt: new Date().toISOString(),
      ...overrides,
    },
  );
}

function makeTx() {
  return {
    policyRecomputeJob: {
      findFirst: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    auditEvent: { create: jest.fn().mockResolvedValue({}) },
    outboxEvent: { create: jest.fn().mockResolvedValue({}) },
    employee: {
      findFirst: jest.fn().mockResolvedValue({ id: 'emp-1', locationId: null, shift: null }),
    },
    attendancePunch: { findMany: jest.fn().mockResolvedValue([]) },
    holiday: { findMany: jest.fn().mockResolvedValue([]) },
    attendanceDay: { upsert: jest.fn().mockResolvedValue({ id: 'day-id' }) },
    attendanceException: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
  };
}

function makePrisma(tx: ReturnType<typeof makeTx>) {
  return {
    tenant: { findFirst: jest.fn().mockResolvedValue({ timezone: 'UTC' }) },
    attendanceDay: { findMany: jest.fn().mockResolvedValue([]) },
    $transaction: jest.fn((callback: (tx: unknown) => unknown) => callback(tx)),
  };
}

function dayRow(id: string, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id,
    employeeId: 'emp-1',
    workDate: new Date('2026-08-12'),
    periodId: 'period-1',
    ...overrides,
  };
}

beforeEach(() => {
  mockResolveEffectivePolicy.mockReset();
  mockResolveEffectivePolicy.mockResolvedValue({
    policyVersion: { id: 'policy-version-id', effectiveFrom: new Date('2026-08-01'), workingWeekdays: [] } as never,
    rules: {
      lateArrival: { graceMinutes: 10 },
      earlyDeparture: { graceMinutes: 10 },
      overtime: { thresholdMinutes: 30, dailyCapMinutes: null, roundingMinutes: 15 },
      halfDay: { halfDayThresholdMinutes: 240 },
      absence: { lop: true },
    },
    scopeType: 'TENANT' as never,
    scopeId: tenantId,
    scopeChainEvaluated: [],
  });
});

describe('AttendanceEventProcessor recompute handling', () => {
  it('does nothing when the recompute job is already COMPLETED', async () => {
    const tx = makeTx();
    tx.policyRecomputeJob.findFirst.mockResolvedValue({ id: recomputeJobId, status: 'COMPLETED' });
    const prisma = makePrisma(tx);
    const processor = new AttendanceEventProcessor(
      prisma as unknown as PrismaClient,
      {} as unknown as S3Client,
      config,
    );
    await processor.process(makeEvent());
    expect(prisma.attendanceDay.findMany).not.toHaveBeenCalled();
  });

  it('claims a PENDING job, moving it to PROCESSING with an audit event', async () => {
    const tx = makeTx();
    tx.policyRecomputeJob.findFirst.mockResolvedValue({ id: recomputeJobId, status: 'PENDING' });
    const prisma = makePrisma(tx);
    const processor = new AttendanceEventProcessor(
      prisma as unknown as PrismaClient,
      {} as unknown as S3Client,
      config,
    );
    await processor.process(makeEvent());
    expect(tx.policyRecomputeJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: recomputeJobId, tenantId, status: 'PENDING' },
        data: expect.objectContaining({ status: 'PROCESSING' }),
      }),
    );
    expect(tx.auditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'policy.recompute.processing' }),
      }),
    );
  });

  it.each([
    ['LOCATION', 'loc-1', { locationId: 'loc-1' }],
    ['DEPARTMENT', 'dept-1', { departmentId: 'dept-1' }],
    ['EMPLOYEE_GROUP', 'group-1', { groupMemberships: { some: { groupId: 'group-1' } } }],
    ['TENANT', tenantId, {}],
  ] as const)('builds the correct employee filter for %s scope', async (scopeType, scopeId, expectedFilter) => {
    const tx = makeTx();
    tx.policyRecomputeJob.findFirst.mockResolvedValue({ id: recomputeJobId, status: 'PENDING' });
    const prisma = makePrisma(tx);
    const processor = new AttendanceEventProcessor(
      prisma as unknown as PrismaClient,
      {} as unknown as S3Client,
      config,
    );
    await processor.process(makeEvent({ scopeType, scopeId }));
    expect(prisma.attendanceDay.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ employee: expectedFilter }),
      }),
    );
  });

  it('filters directly on employeeId for EMPLOYEE scope rather than the employee relation', async () => {
    const tx = makeTx();
    tx.policyRecomputeJob.findFirst.mockResolvedValue({ id: recomputeJobId, status: 'PENDING' });
    const prisma = makePrisma(tx);
    const processor = new AttendanceEventProcessor(
      prisma as unknown as PrismaClient,
      {} as unknown as S3Client,
      config,
    );
    await processor.process(makeEvent({ scopeType: 'EMPLOYEE', scopeId: 'emp-42' }));
    expect(prisma.attendanceDay.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ employeeId: 'emp-42' }),
      }),
    );
    const call = prisma.attendanceDay.findMany.mock.calls[0][0];
    expect(call.where.employee).toBeUndefined();
  });

  it('paginates across multiple batches by cursor, each batch in its own transaction, and completes the job', async () => {
    const tx = makeTx();
    tx.policyRecomputeJob.findFirst.mockResolvedValue({ id: recomputeJobId, status: 'PENDING' });
    const firstPage = Array.from({ length: 200 }, (_, i) => dayRow(`day-${i}`));
    const secondPage = [dayRow('day-200'), dayRow('day-201'), dayRow('day-202')];
    const prisma = makePrisma(tx);
    prisma.attendanceDay.findMany
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce(secondPage)
      .mockResolvedValueOnce([]);
    const processor = new AttendanceEventProcessor(
      prisma as unknown as PrismaClient,
      {} as unknown as S3Client,
      config,
    );
    await processor.process(makeEvent());

    expect(prisma.attendanceDay.findMany).toHaveBeenCalledTimes(3);
    expect(prisma.attendanceDay.findMany.mock.calls[1][0]).toMatchObject({
      cursor: { id: 'day-199' },
      skip: 1,
    });
    expect(prisma.attendanceDay.findMany.mock.calls[2][0]).toMatchObject({
      cursor: { id: 'day-202' },
      skip: 1,
    });
    // one transaction for the claim, one per non-empty page (2), one for completion = 4
    expect(prisma.$transaction).toHaveBeenCalledTimes(4);

    expect(tx.policyRecomputeJob.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { id: recomputeJobId, tenantId, status: 'PROCESSING' },
        data: expect.objectContaining({
          status: 'COMPLETED',
          daysMatched: 203,
          daysRecomputed: 203,
        }),
      }),
    );
    expect(tx.outboxEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ eventType: 'attendance.day.recompute-completed.v1' }),
      }),
    );
  });

  it('fails the job and publishes a FAILED completion event on a permanent error', async () => {
    const tx = makeTx();
    tx.policyRecomputeJob.findFirst.mockResolvedValue({ id: recomputeJobId, status: 'PENDING' });
    tx.employee.findFirst.mockResolvedValue(null); // triggers PermanentJobError EMPLOYEE_NOT_FOUND
    const prisma = makePrisma(tx);
    prisma.attendanceDay.findMany.mockResolvedValueOnce([dayRow('day-0')]);
    const processor = new AttendanceEventProcessor(
      prisma as unknown as PrismaClient,
      {} as unknown as S3Client,
      config,
    );
    await processor.process(makeEvent());

    expect(tx.policyRecomputeJob.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: {
          id: recomputeJobId,
          tenantId,
          status: { in: ['PENDING', 'PROCESSING'] },
        },
        data: expect.objectContaining({ status: 'FAILED', errorCode: 'EMPLOYEE_NOT_FOUND' }),
      }),
    );
    expect(tx.outboxEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ eventType: 'attendance.day.recompute-completed.v1' }),
      }),
    );
  });
});
