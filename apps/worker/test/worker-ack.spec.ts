import type { Message, SQSClient } from '@aws-sdk/client-sqs';
import { Prisma, type PrismaClient } from '@prisma/client';
import type { WorkerConfig } from '../src/config';
import type { AttendanceEventProcessor } from '../src/processor';
import { AttendanceSqsWorker } from '../src/worker';

const config: WorkerConfig = {
  queueUrl: 'https://sqs.example/queue.fifo',
  importBucket: 'imports',
  exportBucket: 'exports',
  concurrency: 1,
  visibilitySeconds: 60,
  maxRows: 10,
  maxColumns: 10,
  maxCellBytes: 100,
  maxArchiveBytes: 1000,
  maxArchiveRatio: 10,
};

const message: Message = {
  ReceiptHandle: 'receipt',
  Body: JSON.stringify({
    schemaVersion: 1,
    eventId: '81d4fae4-6c11-4bb5-9170-eea7fe9d9dd0',
    eventType: 'attendance.import.requested.v1',
    occurredAt: '2026-08-28T08:00:00.000Z',
    tenantId: 'de305d54-75b4-431b-adb2-eb6b9e546014',
    periodId: 'c56a4180-65aa-42ec-a945-5fd21dec0538',
    importJobId: '8d11d74a-e6b1-4a4c-9104-59538a65f28d',
    source: 'MANUAL_FILE',
    requestedBy: 'actor',
    requestedAt: '2026-08-28T08:00:00.000Z',
  }),
};

describe('AttendanceSqsWorker acknowledgement', () => {
  it('acknowledges a completed duplicate with an observable correlation log', async () => {
    const send = jest.fn().mockResolvedValue({});
    const prisma = {
      eventLedger: {
        create: jest.fn().mockRejectedValue(
          new Prisma.PrismaClientKnownRequestError('duplicate', {
            code: 'P2002',
            clientVersion: '6.12.0',
          }),
        ),
        findUnique: jest.fn().mockResolvedValue({
          eventId: '81d4fae4-6c11-4bb5-9170-eea7fe9d9dd0',
          tenantId: 'de305d54-75b4-431b-adb2-eb6b9e546014',
          eventType: 'attendance.import.requested.v1',
          status: 'COMPLETED',
          lockedUntil: null,
        }),
      },
    } as unknown as PrismaClient;
    const processor = {
      process: jest.fn(),
    } as unknown as AttendanceEventProcessor;
    const log = jest.spyOn(console, 'log').mockImplementation();
    const worker = new AttendanceSqsWorker(
      prisma,
      { send } as unknown as SQSClient,
      processor,
      config,
    );

    await (
      worker as unknown as { handle(message: Message): Promise<void> }
    ).handle(message);

    expect(processor.process).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('"message":"duplicate event acknowledged"'),
    );
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining(
        '"correlationId":"81d4fae4-6c11-4bb5-9170-eea7fe9d9dd0"',
      ),
    );
    log.mockRestore();
  });

  it('does not delete a message when processing fails', async () => {
    const send = jest.fn();
    const prisma = {
      eventLedger: {
        create: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    } as unknown as PrismaClient;
    const processor = {
      process: jest.fn().mockRejectedValue(new Error('database unavailable')),
    } as unknown as AttendanceEventProcessor;
    const worker = new AttendanceSqsWorker(
      prisma,
      { send } as unknown as SQSClient,
      processor,
      config,
    );
    await (
      worker as unknown as { handle(message: Message): Promise<void> }
    ).handle(message);
    expect(send).not.toHaveBeenCalled();
    expect(prisma.eventLedger.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'FAILED' }),
      }),
    );
  });

  it('does not clear another worker lease when a duplicate delivery races', async () => {
    const updateMany = jest.fn();
    const prisma = {
      eventLedger: {
        create: jest.fn().mockRejectedValue(
          new Prisma.PrismaClientKnownRequestError('duplicate', {
            code: 'P2002',
            clientVersion: '6.12.0',
          }),
        ),
        findUnique: jest.fn().mockResolvedValue({
          eventId: '81d4fae4-6c11-4bb5-9170-eea7fe9d9dd0',
          tenantId: 'de305d54-75b4-431b-adb2-eb6b9e546014',
          eventType: 'attendance.import.requested.v1',
          status: 'PROCESSING',
          lockedUntil: new Date(Date.now() + 60_000),
        }),
        updateMany,
      },
    } as unknown as PrismaClient;
    const processor = {
      process: jest.fn(),
    } as unknown as AttendanceEventProcessor;
    const worker = new AttendanceSqsWorker(
      prisma,
      { send: jest.fn() } as unknown as SQSClient,
      processor,
      config,
    );
    await (
      worker as unknown as { handle(message: Message): Promise<void> }
    ).handle(message);
    expect(updateMany).not.toHaveBeenCalled();
    expect(processor.process).not.toHaveBeenCalled();
  });
});
