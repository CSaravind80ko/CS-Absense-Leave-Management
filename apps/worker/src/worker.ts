import {
  ChangeMessageVisibilityCommand,
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SQSClient,
  type Message,
} from '@aws-sdk/client-sqs';
import { Prisma, PrismaClient } from '@prisma/client';
import { parseAttendanceEvent, type AttendanceEvent } from '@attendance/contracts';
import type { WorkerConfig } from './config';
import { log } from './logger';
import { AttendanceEventProcessor } from './processor';

export class AttendanceSqsWorker {
  private stopping = false;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly sqs: SQSClient,
    private readonly processor: AttendanceEventProcessor,
    private readonly config: WorkerConfig,
  ) {}

  stop(): void {
    this.stopping = true;
  }

  async run(): Promise<void> {
    log('info', 'attendance worker started', {
      concurrency: this.config.concurrency,
      visibilitySeconds: this.config.visibilitySeconds,
    });
    while (!this.stopping) {
      try {
        const response = await this.sqs.send(
          new ReceiveMessageCommand({
            QueueUrl: this.config.queueUrl,
            MaxNumberOfMessages: Math.min(10, this.config.concurrency),
            WaitTimeSeconds: 20,
            VisibilityTimeout: this.config.visibilitySeconds,
            MessageSystemAttributeNames: ['ApproximateReceiveCount'],
            MessageAttributeNames: ['All'],
          }),
        );
        await Promise.all((response.Messages ?? []).map((message) => this.handle(message)));
      } catch (error) {
        log('error', 'SQS receive loop failed', {
          error: error instanceof Error ? error.message : String(error),
        });
        await delay(1000);
      }
    }
    log('info', 'attendance worker stopped');
  }

  private async handle(message: Message): Promise<void> {
    let event: AttendanceEvent | undefined;
    let heartbeat: NodeJS.Timeout | undefined;
    let claimedByThisWorker = false;
    try {
      if (!message.Body || !message.ReceiptHandle) {
        throw new Error('SQS message is missing body or receipt handle');
      }
      event = parseAttendanceEvent(JSON.parse(message.Body));
      const shouldProcess = await this.claimEvent(event);
      if (!shouldProcess) {
        await this.deleteMessage(message.ReceiptHandle);
        return;
      }
      claimedByThisWorker = true;
      heartbeat = setInterval(() => {
        void this.extendVisibility(message.ReceiptHandle!, event!.eventId);
      }, Math.max(20_000, Math.floor((this.config.visibilitySeconds * 1000) / 3)));
      await this.processor.process(event);
      await this.prisma.eventLedger.update({
        where: { eventId: event.eventId },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          lockedUntil: null,
          lastError: null,
        },
      });
      await this.deleteMessage(message.ReceiptHandle);
      log('info', 'event processed', {
        correlationId: event.eventId,
        eventType: event.eventType,
        tenantId: event.tenantId,
        receiveCount: message.Attributes?.ApproximateReceiveCount,
      });
    } catch (error) {
      if (event && claimedByThisWorker) {
        await this.prisma.eventLedger.updateMany({
          where: { eventId: event.eventId, status: 'PROCESSING' },
          data: {
            status: 'FAILED',
            lockedUntil: null,
            lastError:
              error instanceof Error
                ? error.message.slice(0, 1000)
                : 'Unknown worker failure',
          },
        });
      }
      log('error', 'event processing failed; message retained for retry/DLQ', {
        correlationId: event?.eventId,
        eventType: event?.eventType,
        tenantId: event?.tenantId,
        receiveCount: message.Attributes?.ApproximateReceiveCount,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      if (heartbeat) clearInterval(heartbeat);
    }
  }

  private async claimEvent(event: AttendanceEvent): Promise<boolean> {
    const lockedUntil = new Date(Date.now() + this.config.visibilitySeconds * 1000);
    try {
      await this.prisma.eventLedger.create({
        data: {
          eventId: event.eventId,
          tenantId: event.tenantId,
          eventType: event.eventType,
          status: 'PROCESSING',
          lockedUntil,
        },
      });
      return true;
    } catch (error) {
      if (
        !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        error.code !== 'P2002'
      ) throw error;
    }
    const existing = await this.prisma.eventLedger.findUnique({
      where: { eventId: event.eventId },
    });
    if (!existing) throw new Error('Event ledger race could not be resolved');
    if (existing.tenantId !== event.tenantId || existing.eventType !== event.eventType) {
      throw new Error('Event ID was reused with a different tenant or event type');
    }
    if (existing.status === 'COMPLETED') return false;
    if (
      existing.status === 'PROCESSING' &&
      existing.lockedUntil &&
      existing.lockedUntil > new Date()
    ) {
      throw new Error('Event is already leased by another worker');
    }
    const claimed = await this.prisma.eventLedger.updateMany({
      where: {
        eventId: event.eventId,
        status: { in: ['FAILED', 'PROCESSING'] },
        OR: [{ lockedUntil: null }, { lockedUntil: { lte: new Date() } }],
      },
      data: {
        status: 'PROCESSING',
        lockedUntil,
        attemptCount: { increment: 1 },
        lastError: null,
      },
    });
    if (claimed.count !== 1) throw new Error('Event lease was claimed concurrently');
    return true;
  }

  private async extendVisibility(receiptHandle: string, eventId: string): Promise<void> {
    try {
      await Promise.all([
        this.sqs.send(
          new ChangeMessageVisibilityCommand({
            QueueUrl: this.config.queueUrl,
            ReceiptHandle: receiptHandle,
            VisibilityTimeout: this.config.visibilitySeconds,
          }),
        ),
        this.prisma.eventLedger.updateMany({
          where: { eventId, status: 'PROCESSING' },
          data: {
            lockedUntil: new Date(Date.now() + this.config.visibilitySeconds * 1000),
          },
        }),
      ]);
    } catch (error) {
      log('warn', 'message visibility extension failed', {
        correlationId: eventId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async deleteMessage(receiptHandle: string): Promise<void> {
    await this.sqs.send(
      new DeleteMessageCommand({
        QueueUrl: this.config.queueUrl,
        ReceiptHandle: receiptHandle,
      }),
    );
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
