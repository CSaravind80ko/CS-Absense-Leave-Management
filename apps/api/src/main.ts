import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { json } from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { configureDatabaseUrl } from './config/database';

async function bootstrap(): Promise<void> {
  configureDatabaseUrl();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });
  // Behind the ALB, express.req.ip otherwise resolves to the load balancer's address for
  // every request, which would make the rate limiter treat all clients as a single one.
  app.set('trust proxy', Number(process.env.API_TRUST_PROXY_HOPS ?? 1));
  app.use(helmet());
  app.use(
    json({
      limit: process.env.API_JSON_BODY_LIMIT ?? '256kb',
      type: ['application/json', 'application/scim+json'],
    }),
  );
  app.setGlobalPrefix('api/v1');
  app.enableCors({
    origin: (process.env.WEB_ORIGINS ?? 'http://localhost:5173')
      .split(',')
      .map((origin) => origin.trim()),
    credentials: true,
  });
  app.enableShutdownHooks();
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  await app.listen(Number(process.env.PORT ?? 3001));
}

void bootstrap();
