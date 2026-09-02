import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { json } from 'express';
import { AppModule } from './app.module';
import { configureDatabaseUrl } from './config/database';

async function bootstrap(): Promise<void> {
  configureDatabaseUrl();
  const app = await NestFactory.create(AppModule, { bodyParser: false });
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
