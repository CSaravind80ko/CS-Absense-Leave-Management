import { PrismaClient } from '@prisma/client';
import { AnomalyDetectionService } from '../src/anomaly-detection';

const tenantId = 'de305d54-75b4-431b-adb2-eb6b9e546014';
const employeeId = '8d11d74a-e6b1-4a4c-9104-59538a65f28d';

function rowsOf(count: number, type = 'LATE_ARRIVAL', employee = employeeId) {
  return Array.from({ length: count }, () => ({ tenantId, employeeId: employee, type }));
}

describe('AnomalyDetectionService.sweep', () => {
  const originalThreshold = process.env.ANOMALY_PATTERN_THRESHOLD;
  beforeAll(() => {
    process.env.ANOMALY_PATTERN_THRESHOLD = '4';
  });
  afterAll(() => {
    process.env.ANOMALY_PATTERN_THRESHOLD = originalThreshold;
  });

  it('does nothing when no employee reaches the threshold', async () => {
    const create = jest.fn();
    const prisma = {
      attendanceException: { findMany: jest.fn().mockResolvedValue(rowsOf(3)), create },
    } as unknown as PrismaClient;
    const service = new AnomalyDetectionService(prisma);

    await expect(service.sweep()).resolves.toBe(0);
    expect(create).not.toHaveBeenCalled();
  });

  it('creates a RECURRING_PATTERN exception once an employee crosses the threshold for one type', async () => {
    const create = jest.fn().mockResolvedValue({});
    const prisma = {
      attendanceException: {
        findMany: jest.fn().mockResolvedValue(rowsOf(4)),
        findFirst: jest.fn().mockResolvedValue(null),
        create,
      },
    } as unknown as PrismaClient;
    const service = new AnomalyDetectionService(prisma);

    await expect(service.sweep()).resolves.toBe(1);
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId,
        employeeId,
        type: 'RECURRING_PATTERN',
        severity: 'HIGH',
        dedupeKey: expect.stringContaining(`anomaly:${employeeId}:LATE_ARRIVAL:`),
        details: expect.objectContaining({ patternType: 'LATE_ARRIVAL', occurrenceCount: 4 }),
      }),
    });
  });

  it('refreshes an existing OPEN exception instead of creating a duplicate, and does not recount it as newly flagged', async () => {
    const update = jest.fn().mockResolvedValue({});
    const create = jest.fn();
    const prisma = {
      attendanceException: {
        findMany: jest.fn().mockResolvedValue(rowsOf(5)),
        findFirst: jest.fn().mockResolvedValue({ id: 'existing-id', status: 'OPEN' }),
        update,
        create,
      },
    } as unknown as PrismaClient;
    const service = new AnomalyDetectionService(prisma);

    await expect(service.sweep()).resolves.toBe(0);
    expect(update).toHaveBeenCalledWith({
      where: { id: 'existing-id' },
      data: { details: expect.objectContaining({ occurrenceCount: 5 }) },
    });
    expect(create).not.toHaveBeenCalled();
  });

  it('leaves an already-resolved exception alone rather than reopening or duplicating it', async () => {
    const update = jest.fn();
    const create = jest.fn();
    const prisma = {
      attendanceException: {
        findMany: jest.fn().mockResolvedValue(rowsOf(5)),
        findFirst: jest.fn().mockResolvedValue({ id: 'resolved-id', status: 'RESOLVED' }),
        update,
        create,
      },
    } as unknown as PrismaClient;
    const service = new AnomalyDetectionService(prisma);

    await expect(service.sweep()).resolves.toBe(0);
    expect(update).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('ignores exception rows with no linked employee', async () => {
    const create = jest.fn();
    const prisma = {
      attendanceException: {
        findMany: jest.fn().mockResolvedValue([
          { tenantId, employeeId: null, type: 'LATE_ARRIVAL' },
          { tenantId, employeeId: null, type: 'LATE_ARRIVAL' },
          { tenantId, employeeId: null, type: 'LATE_ARRIVAL' },
          { tenantId, employeeId: null, type: 'LATE_ARRIVAL' },
        ]),
        create,
      },
    } as unknown as PrismaClient;
    const service = new AnomalyDetectionService(prisma);

    await expect(service.sweep()).resolves.toBe(0);
    expect(create).not.toHaveBeenCalled();
  });

  it('tracks each employee and pattern type as an independent bucket', async () => {
    const create = jest.fn().mockResolvedValue({});
    const otherEmployeeId = 'c56a4180-65aa-42ec-a945-5fd21dec0538';
    const prisma = {
      attendanceException: {
        findMany: jest.fn().mockResolvedValue([
          ...rowsOf(4, 'LATE_ARRIVAL', employeeId),
          ...rowsOf(2, 'OUT_OF_LOCATION', employeeId),
          ...rowsOf(1, 'LATE_ARRIVAL', otherEmployeeId),
        ]),
        findFirst: jest.fn().mockResolvedValue(null),
        create,
      },
    } as unknown as PrismaClient;
    const service = new AnomalyDetectionService(prisma);

    await expect(service.sweep()).resolves.toBe(1);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ employeeId, type: 'RECURRING_PATTERN' }),
      }),
    );
  });
});
