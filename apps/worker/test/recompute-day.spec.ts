import type { Prisma } from '@prisma/client';
import { recomputeDay } from '../src/processor';
import { resolveEffectivePolicy, type PolicyRules } from '../src/policy-resolution';

jest.mock('../src/policy-resolution', () => ({
  resolveEffectivePolicy: jest.fn(),
}));

const mockResolveEffectivePolicy = resolveEffectivePolicy as jest.MockedFunction<
  typeof resolveEffectivePolicy
>;

const tenantId = 'de305d54-75b4-431b-adb2-eb6b9e546014';
const periodId = 'c56a4180-65aa-42ec-a945-5fd21dec0538';
const employeeId = '8d11d74a-e6b1-4a4c-9104-59538a65f28d';
const locationId = '81d4fae4-6c11-4bb5-9170-eea7fe9d9dd0';
const workDate = new Date('2026-08-12T00:00:00.000Z');

const baseRules: PolicyRules = {
  lateArrival: { graceMinutes: 10 },
  earlyDeparture: { graceMinutes: 10 },
  overtime: { thresholdMinutes: 30, dailyCapMinutes: 120, roundingMinutes: 15 },
  halfDay: { halfDayThresholdMinutes: 240 },
  absence: { lop: true },
};

function mockPolicy(overrides: {
  rules?: PolicyRules;
  workingWeekdays?: number[];
  scopeType?: string;
}) {
  mockResolveEffectivePolicy.mockResolvedValue({
    policyVersion: {
      id: 'policy-version-id',
      effectiveFrom: new Date('2026-08-01'),
      workingWeekdays: overrides.workingWeekdays ?? [1, 2, 3, 4, 5, 6, 7],
    } as never,
    rules: overrides.rules ?? baseRules,
    scopeType: (overrides.scopeType ?? 'TENANT') as never,
    scopeId: tenantId,
    scopeChainEvaluated: [],
  });
}

function punch(type: 'IN' | 'OUT', isoTime: string) {
  return { type, occurredAt: new Date(isoTime), source: 'TEST' };
}

function makeTx(options: {
  shift?: Record<string, unknown> | null;
  punches: ReturnType<typeof punch>[];
  holidays?: Array<{ id: string; name: string; locationId: string | null }>;
  exceptionCreateManyCount?: number | 'echo';
}) {
  const shift =
    options.shift === undefined
      ? { startMinutes: 570, endMinutes: 1080, breakMinutes: 30, graceMinutes: 0, crossesMidnight: false }
      : options.shift;
  const attendanceDayUpsert = jest.fn().mockResolvedValue({ id: 'day-id' });
  const attendanceExceptionCreateMany = jest.fn().mockImplementation(
    (args: { data: unknown[] }) =>
      Promise.resolve({
        count:
          options.exceptionCreateManyCount === 'echo' || options.exceptionCreateManyCount === undefined
            ? args.data.length
            : options.exceptionCreateManyCount,
      }),
  );
  const tx = {
    employee: {
      findFirst: jest.fn().mockResolvedValue({
        id: employeeId,
        locationId,
        shift,
      }),
    },
    attendancePunch: {
      findMany: jest.fn().mockResolvedValue(options.punches),
    },
    holiday: {
      findMany: jest.fn().mockResolvedValue(options.holidays ?? []),
    },
    attendanceDay: { upsert: attendanceDayUpsert },
    attendanceException: { createMany: attendanceExceptionCreateMany },
  } as unknown as Prisma.TransactionClient;
  return { tx, attendanceDayUpsert, attendanceExceptionCreateMany };
}

function exceptionTypes(createMany: jest.Mock): string[] {
  const call = createMany.mock.calls.at(-1) as [{ data: Array<{ type: string }> }] | undefined;
  if (!call) return [];
  return call[0].data.map((row) => row.type);
}

function findException(createMany: jest.Mock, type: string) {
  const call = createMany.mock.calls.at(-1) as [{ data: Array<Record<string, unknown>> }];
  return call[0].data.find((row) => row.type === type);
}

beforeEach(() => {
  mockResolveEffectivePolicy.mockReset();
});

describe('recomputeDay', () => {
  it('flags late arrival beyond the grace period', async () => {
    mockPolicy({});
    const { tx, attendanceDayUpsert, attendanceExceptionCreateMany } = makeTx({
      punches: [punch('IN', '2026-08-12T09:45:00.000Z'), punch('OUT', '2026-08-12T18:00:00.000Z')],
    });
    const result = await recomputeDay(tx, { tenantId, periodId, employeeId, workDate, timezone: 'UTC' });
    expect(result.exceptionsOpened).toBeGreaterThan(0);
    const lateException = findException(attendanceExceptionCreateMany, 'LATE_ARRIVAL');
    expect(lateException).toMatchObject({
      dedupeKey: 'day:day-id:late-arrival',
      severity: 'MEDIUM',
      payrollImpactMinutes: 5,
    });
    expect(attendanceDayUpsert).toHaveBeenCalled();
  });

  it('does not flag late arrival within the grace period', async () => {
    mockPolicy({});
    const { tx, attendanceExceptionCreateMany } = makeTx({
      punches: [punch('IN', '2026-08-12T09:35:00.000Z'), punch('OUT', '2026-08-12T18:00:00.000Z')],
    });
    await recomputeDay(tx, { tenantId, periodId, employeeId, workDate, timezone: 'UTC' });
    expect(exceptionTypes(attendanceExceptionCreateMany)).not.toContain('LATE_ARRIVAL');
  });

  it('flags early departure beyond the grace period', async () => {
    mockPolicy({});
    const { tx, attendanceExceptionCreateMany } = makeTx({
      punches: [punch('IN', '2026-08-12T09:35:00.000Z'), punch('OUT', '2026-08-12T17:40:00.000Z')],
    });
    await recomputeDay(tx, { tenantId, periodId, employeeId, workDate, timezone: 'UTC' });
    const earlyException = findException(attendanceExceptionCreateMany, 'EARLY_DEPARTURE');
    expect(earlyException).toMatchObject({
      dedupeKey: 'day:day-id:early-departure',
      payrollImpactMinutes: 10,
    });
  });

  it('does not flag early departure while a punch is still open (missing OUT)', async () => {
    mockPolicy({});
    const { tx, attendanceExceptionCreateMany } = makeTx({
      punches: [punch('IN', '2026-08-12T09:35:00.000Z')],
    });
    await recomputeDay(tx, { tenantId, periodId, employeeId, workDate, timezone: 'UTC' });
    expect(exceptionTypes(attendanceExceptionCreateMany)).not.toContain('EARLY_DEPARTURE');
  });

  it('computes overtime beyond the threshold, rounded down to the rounding unit and capped', async () => {
    mockPolicy({
      rules: {
        ...baseRules,
        overtime: { thresholdMinutes: 0, dailyCapMinutes: null, roundingMinutes: 15 },
      },
    });
    const { tx, attendanceExceptionCreateMany } = makeTx({
      // scheduled = 480m (09:30-18:00 minus 30m break); worked = 577m => excess 97m => floor(97/15)*15 = 90
      punches: [punch('IN', '2026-08-12T09:00:00.000Z'), punch('OUT', '2026-08-12T18:37:00.000Z')],
    });
    await recomputeDay(tx, { tenantId, periodId, employeeId, workDate, timezone: 'UTC' });
    const overtimeException = findException(attendanceExceptionCreateMany, 'OVERTIME');
    expect(overtimeException).toMatchObject({
      dedupeKey: 'day:day-id:overtime',
      payrollImpactMinutes: 90,
    });
  });

  it('caps overtime at the configured daily cap', async () => {
    mockPolicy({
      rules: {
        ...baseRules,
        overtime: { thresholdMinutes: 0, dailyCapMinutes: 60, roundingMinutes: 15 },
      },
    });
    const { tx, attendanceExceptionCreateMany } = makeTx({
      punches: [punch('IN', '2026-08-12T09:00:00.000Z'), punch('OUT', '2026-08-12T18:37:00.000Z')],
    });
    await recomputeDay(tx, { tenantId, periodId, employeeId, workDate, timezone: 'UTC' });
    const overtimeException = findException(attendanceExceptionCreateMany, 'OVERTIME');
    expect(overtimeException).toMatchObject({ payrollImpactMinutes: 60 });
  });

  it('treats a Holiday-calendar day as HOLIDAY with zero scheduled minutes and worked time as overtime', async () => {
    mockPolicy({ workingWeekdays: [1, 2, 3, 4, 5, 6, 7] });
    const { tx, attendanceDayUpsert, attendanceExceptionCreateMany } = makeTx({
      punches: [punch('IN', '2026-08-12T09:00:00.000Z'), punch('OUT', '2026-08-12T13:00:00.000Z')],
      holidays: [{ id: 'holiday-1', name: 'Independence Day', locationId: null }],
    });
    await recomputeDay(tx, { tenantId, periodId, employeeId, workDate, timezone: 'UTC' });
    const createArgs = attendanceDayUpsert.mock.calls[0][0].create;
    expect(createArgs.status).toBe('HOLIDAY');
    expect(createArgs.scheduledMinutes).toBe(0);
    expect(createArgs.overtimeMinutes).toBe(240);
    expect(exceptionTypes(attendanceExceptionCreateMany)).not.toContain('MISSING_PUNCH');
    expect(exceptionTypes(attendanceExceptionCreateMany)).toContain('OVERTIME');
  });

  it('prefers a location-specific holiday over a tenant-wide one on the same date', async () => {
    mockPolicy({});
    const { tx, attendanceDayUpsert } = makeTx({
      punches: [],
      holidays: [
        { id: 'tenant-wide', name: 'Tenant Holiday', locationId: null },
        { id: 'location-specific', name: 'Regional Holiday', locationId },
      ],
    });
    await recomputeDay(tx, { tenantId, periodId, employeeId, workDate, timezone: 'UTC' });
    const createArgs = attendanceDayUpsert.mock.calls[0][0].create;
    expect(createArgs.calculationTrace.holiday).toMatchObject({
      id: 'location-specific',
      name: 'Regional Holiday',
    });
  });

  it('treats a non-working weekday as WEEKEND', async () => {
    mockPolicy({ workingWeekdays: [] });
    const { tx, attendanceDayUpsert } = makeTx({ punches: [] });
    await recomputeDay(tx, { tenantId, periodId, employeeId, workDate, timezone: 'UTC' });
    const createArgs = attendanceDayUpsert.mock.calls[0][0].create;
    expect(createArgs.status).toBe('WEEKEND');
    expect(createArgs.scheduledMinutes).toBe(0);
  });

  it('preserves the existing ABSENT threshold: zero worked minutes on a working day', async () => {
    mockPolicy({});
    const { tx, attendanceDayUpsert, attendanceExceptionCreateMany } = makeTx({ punches: [] });
    await recomputeDay(tx, { tenantId, periodId, employeeId, workDate, timezone: 'UTC' });
    const createArgs = attendanceDayUpsert.mock.calls[0][0].create;
    expect(createArgs.status).toBe('ABSENT');
    expect(createArgs.scheduledMinutes).toBe(480);
    expect(exceptionTypes(attendanceExceptionCreateMany)).toEqual(
      expect.arrayContaining(['MISSING_PUNCH', 'ABSENCE']),
    );
    const absence = findException(attendanceExceptionCreateMany, 'ABSENCE');
    expect(absence).toMatchObject({ payrollImpactMinutes: 480, payrollImpact: 'UNPAID_MINUTES' });
  });

  it('preserves the existing PARTIAL threshold and opens a half-day ABSENCE below the half-day threshold', async () => {
    mockPolicy({});
    const { tx, attendanceDayUpsert, attendanceExceptionCreateMany } = makeTx({
      // worked 150m, below the 240m half-day threshold, above zero, below scheduled 480m
      punches: [punch('IN', '2026-08-12T09:30:00.000Z'), punch('OUT', '2026-08-12T12:00:00.000Z')],
    });
    await recomputeDay(tx, { tenantId, periodId, employeeId, workDate, timezone: 'UTC' });
    const createArgs = attendanceDayUpsert.mock.calls[0][0].create;
    expect(createArgs.status).toBe('PARTIAL');
    const absence = findException(attendanceExceptionCreateMany, 'ABSENCE');
    expect(absence).toMatchObject({ payrollImpactMinutes: 330 });
  });

  it('does not open an ABSENCE exception for a PARTIAL day at or above the half-day threshold', async () => {
    mockPolicy({});
    const { tx, attendanceDayUpsert, attendanceExceptionCreateMany } = makeTx({
      // worked 300m: PARTIAL (below scheduled 480m) but at/above the 240m half-day threshold
      punches: [punch('IN', '2026-08-12T09:30:00.000Z'), punch('OUT', '2026-08-12T14:30:00.000Z')],
    });
    await recomputeDay(tx, { tenantId, periodId, employeeId, workDate, timezone: 'UTC' });
    const createArgs = attendanceDayUpsert.mock.calls[0][0].create;
    expect(createArgs.status).toBe('PARTIAL');
    expect(exceptionTypes(attendanceExceptionCreateMany)).not.toContain('ABSENCE');
  });

  it('gates MISSING_PUNCH off on non-working (HOLIDAY) days even with zero punches', async () => {
    mockPolicy({});
    const { tx, attendanceExceptionCreateMany } = makeTx({
      punches: [],
      holidays: [{ id: 'holiday-1', name: 'Holiday', locationId: null }],
    });
    await recomputeDay(tx, { tenantId, periodId, employeeId, workDate, timezone: 'UTC' });
    expect(exceptionTypes(attendanceExceptionCreateMany)).not.toContain('MISSING_PUNCH');
  });

  it('never reopens or updates an exception that already exists (dedupe-only, skipDuplicates)', async () => {
    mockPolicy({});
    const { tx, attendanceExceptionCreateMany } = makeTx({
      punches: [punch('IN', '2026-08-12T09:45:00.000Z'), punch('OUT', '2026-08-12T18:00:00.000Z')],
      exceptionCreateManyCount: 0,
    });
    // Deliberately no update/updateMany mock on attendanceException — if recomputeDay ever
    // called one to touch an existing exception's status, this would throw a TypeError.
    const result = await recomputeDay(tx, { tenantId, periodId, employeeId, workDate, timezone: 'UTC' });
    expect(attendanceExceptionCreateMany).toHaveBeenCalledWith(
      expect.objectContaining({ skipDuplicates: true }),
    );
    expect(result.exceptionsOpened).toBe(0);
  });

  it('records a calculationTrace with the policy version, scope, day type, and rule evaluations', async () => {
    mockPolicy({});
    const { tx, attendanceDayUpsert } = makeTx({
      punches: [punch('IN', '2026-08-12T09:35:00.000Z'), punch('OUT', '2026-08-12T18:00:00.000Z')],
    });
    await recomputeDay(tx, { tenantId, periodId, employeeId, workDate, timezone: 'UTC' });
    const createArgs = attendanceDayUpsert.mock.calls[0][0].create;
    expect(createArgs.policyVersionId).toBe('policy-version-id');
    expect(createArgs.calculationTrace).toMatchObject({
      policyVersionId: 'policy-version-id',
      scopeType: 'TENANT',
      dayType: 'WORKING',
    });
    const ruleNames = createArgs.calculationTrace.ruleEvaluations.map(
      (entry: { rule: string }) => entry.rule,
    );
    expect(ruleNames).toEqual([
      'LATE_ARRIVAL',
      'EARLY_DEPARTURE',
      'OVERTIME',
      'ABSENCE',
      'MISSING_PUNCH',
    ]);
  });
});
