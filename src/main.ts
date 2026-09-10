import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import express, { Express } from 'express';
import helmet from 'helmet';

import { AppModule } from './app.module';
import { AllExceptionsFilter } from '@/common/filters/http-exception.filter';
import { AppConfig } from '@/config/configuration';

let cachedServer: Express | null = null;

export async function bootstrapServer(): Promise<Express> {
  if (cachedServer) {
    return cachedServer;
  }

  const server = express();
  const app = await NestFactory.create(AppModule, new ExpressAdapter(server));
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
  cachedServer = server;
  return cachedServer;
}

// Local standalone server
if (!process.env.VERCEL) {
  bootstrapServer().then((server) => {
    const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 4000;
    server.listen(port, () => {
      // eslint-disable-next-line no-console
      console.log(`TrackKaro API listening on http://localhost:${port}`);
    });
  });
}

// Vercel Serverless Function entrypoint
export default async function handler(req: any, res: any) {
  const server = await bootstrapServer();
  return server(req, res);
}
