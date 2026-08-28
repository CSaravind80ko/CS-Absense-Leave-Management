import { S3Client } from '@aws-sdk/client-s3';
import { SQSClient } from '@aws-sdk/client-sqs';
import { PrismaClient } from '@prisma/client';
import { loadConfig } from './config';
import { log } from './logger';
import { OutboxDispatcher } from './outbox-dispatcher';
import { AttendanceEventProcessor } from './processor';
import { SqsEventPublisher } from './sqs-publisher';
import { AttendanceSqsWorker } from './worker';

function configureDatabaseUrl(): void {
  if (process.env.DATABASE_URL) return;
  const host = process.env.DATABASE_HOST;
  const name = process.env.DATABASE_NAME;
  const username = process.env.DATABASE_USERNAME;
  const password = process.env.DATABASE_PASSWORD;
  if (!host || !name || !username || !password) {
    throw new Error(
      'DATABASE_URL or DATABASE_HOST/DATABASE_NAME/DATABASE_USERNAME/DATABASE_PASSWORD is required',
    );
  }
  const port = process.env.DATABASE_PORT ?? '5432';
  process.env.DATABASE_URL = `postgresql://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${host}:${port}/${encodeURIComponent(name)}?schema=public`;
}

async function main(): Promise<void> {
  configureDatabaseUrl();
  const config = loadConfig();
  const prisma = new PrismaClient();
  const sqs = new SQSClient({});
  const s3 = new S3Client({});
  await prisma.$connect();
  const publisher = new SqsEventPublisher(sqs, config.queueUrl);
  const dispatcher = new OutboxDispatcher(prisma, publisher);
  const processor = new AttendanceEventProcessor(prisma, s3, config);
  const worker = new AttendanceSqsWorker(prisma, sqs, processor, config);
  let dispatchTimer: NodeJS.Timeout | undefined;

  const shutdown = () => {
    worker.stop();
    if (dispatchTimer) clearInterval(dispatchTimer);
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);

  try {
    await dispatcher.dispatchBatch();
    dispatchTimer = setInterval(() => {
      void dispatcher.dispatchBatch();
    }, 1000);
    await worker.run();
  } finally {
    if (dispatchTimer) clearInterval(dispatchTimer);
    await dispatcher.dispatchBatch();
    await prisma.$disconnect();
  }
}

void main().catch((error) => {
  log('error', 'worker terminated', {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
});
