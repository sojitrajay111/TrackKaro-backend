/**
 * Convenience dev entrypoint that boots the API against an ephemeral in-memory MongoDB
 * instead of a real MONGO_URI — for trying the app live when no local/Atlas MongoDB is set
 * up yet. Data does NOT persist across restarts. Not used by `npm start` / production.
 */
import { MongoMemoryServer } from 'mongodb-memory-server';

async function main() {
  const mongod = await MongoMemoryServer.create();
  process.env.MONGO_URI = mongod.getUri();
  process.env.JWT_ACCESS_SECRET ??= 'dev-access-secret';
  process.env.JWT_REFRESH_SECRET ??= 'dev-refresh-secret';
  process.env.CORS_ORIGINS ??= 'http://localhost:8081,http://localhost:19006';

  const { NestFactory } = await import('@nestjs/core');
  const { ValidationPipe } = await import('@nestjs/common');
  const helmet = (await import('helmet')).default;
  const { AppModule } = await import('./src/app.module');
  const { AllExceptionsFilter } = await import('./src/common/filters/http-exception.filter');

  const app = await NestFactory.create(AppModule);
  app.use(helmet());
  app.enableCors({ origin: process.env.CORS_ORIGINS!.split(','), credentials: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new AllExceptionsFilter());

  const port = 4000;
  await app.listen(port);
  console.log(`\nTrackKaro API (in-memory Mongo, dev-only) listening on http://localhost:${port}`);
  console.log(`Mongo URI: ${mongod.getUri()} — data resets when this process stops.\n`);
}

main().catch((e) => {
  console.error('Dev server failed to start', e);
  process.exit(1);
});
