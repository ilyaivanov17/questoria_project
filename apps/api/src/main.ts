import 'dotenv/config';
import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { assertProductionEnvironment } from './config/production-env.js';
import { getWebOrigin } from './config/web-origin.js';
import { requestContextMiddleware } from './request-context.js';

async function bootstrap(): Promise<void> {
  assertProductionEnvironment();

  const app = await NestFactory.create(AppModule);

  app.use(requestContextMiddleware);
  app.setGlobalPrefix('api');
  app.enableCors({
    origin: getWebOrigin(),
    credentials: true,
    exposedHeaders: ['x-request-id'],
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.enableShutdownHooks();

  const port = Number(process.env.API_PORT ?? 4000);
  await app.listen(port, '0.0.0.0');
}

bootstrap().catch((error: unknown) => {
  console.error('Failed to start Questoria API', error);
  process.exitCode = 1;
});
