import { Prisma } from '@prisma/client';
import type { AttendanceEvent } from '@attendance/contracts';

export async function enqueueOutboxEvent(
  tx: Prisma.TransactionClient,
  aggregateType: string,
  aggregateId: string,
  event: AttendanceEvent,
): Promise<void> {
  await tx.outboxEvent.create({
    data: {
      eventId: event.eventId,
      tenantId: event.tenantId,
      aggregateType,
      aggregateId,
      eventType: event.eventType,
      payload: JSON.parse(JSON.stringify(event)),
    },
  });
}
