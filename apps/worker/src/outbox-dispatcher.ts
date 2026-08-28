import { PrismaClient } from '@prisma/client';
import { parseAttendanceEvent } from '@attendance/contracts';
import type { EventPublisher } from './sqs-publisher';
import { log } from './logger';

interface ClaimedOutbox {
  id: string;
  payload: unknown;
  attemptCount: number;
}

export class OutboxDispatcher {
  private running = false;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly publisher: EventPublisher,
  ) {}

  async dispatchBatch(limit = 20): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    let dispatched = 0;
    try {
      while (dispatched < limit) {
        const row = await this.claim();
        if (!row) break;
        try {
          const event = parseAttendanceEvent(row.payload);
          await this.publisher.publish(event);
          await this.prisma.outboxEvent.update({
            where: { id: row.id },
            data: {
              status: 'PUBLISHED',
              publishedAt: new Date(),
              lastError: null,
            },
          });
          dispatched += 1;
        } catch (error) {
          const retrySeconds = Math.min(900, 2 ** Math.min(row.attemptCount, 9));
          await this.prisma.outboxEvent.update({
            where: { id: row.id },
            data: {
              availableAt: new Date(Date.now() + retrySeconds * 1000),
              lastError: error instanceof Error ? error.message.slice(0, 1000) : 'Unknown dispatch error',
            },
          });
          log('error', 'outbox dispatch failed', {
            outboxId: row.id,
            attempt: row.attemptCount,
            retrySeconds,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      return dispatched;
    } finally {
      this.running = false;
    }
  }

  private async claim(): Promise<ClaimedOutbox | null> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<ClaimedOutbox[]>`
        SELECT "id", "payload", "attemptCount"
        FROM "OutboxEvent"
        WHERE "status" = 'PENDING'
          AND "availableAt" <= NOW()
        ORDER BY "createdAt"
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      `;
      const row = rows[0];
      if (!row) return null;
      const claimed = await tx.outboxEvent.update({
        where: { id: row.id },
        data: {
          attemptCount: { increment: 1 },
          availableAt: new Date(Date.now() + 60_000),
        },
        select: { id: true, payload: true, attemptCount: true },
      });
      return claimed;
    });
  }
}
