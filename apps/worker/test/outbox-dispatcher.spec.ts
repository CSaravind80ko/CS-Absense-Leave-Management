import { PrismaClient } from '@prisma/client';
import type { AttendanceEvent } from '@attendance/contracts';
import { OutboxDispatcher } from '../src/outbox-dispatcher';
import type { EventPublisher } from '../src/sqs-publisher';

const event: AttendanceEvent = {
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
};

describe('OutboxDispatcher', () => {
  it('marks an event published only after the publisher succeeds', async () => {
    const update = jest
      .fn()
      .mockResolvedValueOnce({ id: 'outbox-id', payload: event, attemptCount: 1 })
      .mockResolvedValueOnce({});
    const tx = {
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([{ id: 'outbox-id', payload: event, attemptCount: 0 }])
        .mockResolvedValueOnce([]),
      outboxEvent: { update },
    };
    const prisma = {
      $transaction: jest.fn((callback) => callback(tx)),
      outboxEvent: { update },
    } as unknown as PrismaClient;
    const publisher: EventPublisher = { publish: jest.fn().mockResolvedValue(undefined) };
    await expect(new OutboxDispatcher(prisma, publisher).dispatchBatch()).resolves.toBe(1);
    expect(publisher.publish).toHaveBeenCalledWith(event);
    expect(update).toHaveBeenLastCalledWith({
      where: { id: 'outbox-id' },
      data: expect.objectContaining({ status: 'PUBLISHED' }),
    });
  });

  it('retains and reschedules an event when SQS publication fails', async () => {
    const transactionUpdate = jest
      .fn()
      .mockResolvedValue({ id: 'outbox-id', payload: event, attemptCount: 2 });
    const retryUpdate = jest.fn().mockResolvedValue({});
    const tx = {
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([{ id: 'outbox-id', payload: event, attemptCount: 1 }])
        .mockResolvedValueOnce([]),
      outboxEvent: { update: transactionUpdate },
    };
    const prisma = {
      $transaction: jest.fn((callback) => callback(tx)),
      outboxEvent: { update: retryUpdate },
    } as unknown as PrismaClient;
    const publisher: EventPublisher = {
      publish: jest.fn().mockRejectedValue(new Error('SQS unavailable')),
    };
    await expect(new OutboxDispatcher(prisma, publisher).dispatchBatch()).resolves.toBe(0);
    expect(retryUpdate).toHaveBeenCalledWith({
      where: { id: 'outbox-id' },
      data: expect.objectContaining({ lastError: 'SQS unavailable' }),
    });
  });
});
