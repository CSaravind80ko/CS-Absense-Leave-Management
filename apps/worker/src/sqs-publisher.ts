import {
  SendMessageCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
import type { AttendanceEvent } from '@attendance/contracts';

export interface EventPublisher {
  publish(event: AttendanceEvent): Promise<void>;
}

export class SqsEventPublisher implements EventPublisher {
  constructor(
    private readonly sqs: SQSClient,
    private readonly queueUrl: string,
  ) {}

  async publish(event: AttendanceEvent): Promise<void> {
    await this.sqs.send(
      new SendMessageCommand({
        QueueUrl: this.queueUrl,
        MessageBody: JSON.stringify(event),
        MessageGroupId: `${event.tenantId}:${event.eventType}`,
        MessageDeduplicationId: `${event.tenantId}:${event.eventId}`,
        MessageAttributes: {
          eventType: { DataType: 'String', StringValue: event.eventType },
          tenantId: { DataType: 'String', StringValue: event.tenantId },
          eventId: { DataType: 'String', StringValue: event.eventId },
        },
      }),
    );
  }
}
