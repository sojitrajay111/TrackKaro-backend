import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { INestApplication } from '@nestjs/common';
import helmet from 'helmet';

import { AppModule } from './app.module';
import { AllExceptionsFilter } from '@/common/filters/http-exception.filter';
import { AppConfig } from '@/config/configuration';

let cachedApp: INestApplication | null = null;

export async function bootstrapApp(): Promise<INestApplication> {
  if (cachedApp) {
    return cachedApp;
  }

  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService<AppConfig>);

  app.use(helmet());
  const configuredOrigins = config.get('corsOrigins', { infer: true }) ?? [];
  app.enableCors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (
        configuredOrigins.includes('*') ||
        configuredOrigins.includes(origin) ||
        /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) ||
        /\.vercel\.app$/.test(origin)
      ) {
        return callback(null, true);
      }
      return callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());

  await app.init();
  cachedApp = app;
  return cachedApp;
}

// Local standalone server
if (!process.env.VERCEL) {
  bootstrapApp().then(async (app) => {
    const config = app.get(ConfigService<AppConfig>);
    const port = config.get('port', { infer: true }) ?? 4000;
    await app.listen(port);
    // eslint-disable-next-line no-console
    console.log(`TrackKaro API listening on http://localhost:${port}`);
  });
}

// Vercel Serverless Function entrypoint
export default async function handler(req: any, res: any) {
  const app = await bootstrapApp();
  const instance = app.getHttpAdapter().getInstance();
  return instance(req, res);
}
