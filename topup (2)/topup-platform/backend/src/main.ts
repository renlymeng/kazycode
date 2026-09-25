import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import * as express from 'express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });

  // Trust Cloudflare/reverse-proxy headers for correct client IP in rate limiting.
  app.set('trust proxy', 1);

  app.use(helmet());
  app.enableCors({
    origin: (process.env.CORS_ALLOWED_ORIGINS || '').split(',').filter(Boolean),
    credentials: true,
  });

  // Webhook routes need the exact raw bytes for HMAC verification — mounted
  // BEFORE the global JSON body parser so it doesn't get re-serialized.
  app.use('/payments/webhook/aba', express.raw({ type: '*/*' }), (req: any, _res, next) => {
    req.rawBody = req.body.toString('utf8');
    next();
  });
  app.use('/payments/webhook/payway', express.raw({ type: '*/*' }), (req: any, _res, next) => {
    req.rawBody = req.body.toString('utf8');
    next();
  });

  app.use(express.json({ limit: '1mb' }));

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,          // strips unknown fields — closes mass-assignment holes
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.setGlobalPrefix('api/v1');

  await app.listen(process.env.PORT || 4000);
}
bootstrap();
