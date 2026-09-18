import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';

async function bootstrap() {
  // bufferLogs is intentionally off: if boot fails (e.g. ConfigModule calls
  // process.exit(1) after a bad secret), buffered logs never flush and the
  // process dies silently. Stream logs straight to stdout during boot.
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // App Runner puts a proxy in front of us. Without this, @nestjs/throttler
  // and any IP-derived logic see one proxy IP for every user (requirement.md §8).
  app.set('trust proxy', 1);

  // Baseline security headers (§8). Content-Security-Policy is disabled here
  // because this backend has no HTML surface — the frontend serves its own CSP
  // that permits the Google Maps domains.
  app.use(
    helmet({
      contentSecurityPolicy: false,
      hsts: { maxAge: 31_536_000, includeSubDomains: true, preload: true },
    }),
  );

  // Restrict CORS to the frontend domain only. Never allow `*`.
  const frontendOrigins = (process.env.FRONTEND_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  app.enableCors({
    origin: frontendOrigins.length > 0 ? frontendOrigins : false,
    methods: ['GET', 'POST'],
    credentials: false,
  });

  // Global validation: strip unknown fields AND reject them outright, so
  // the request contract stays explicit (requirement.md §6).
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // Global filter: request ID on every response; Google's error text never leaks.
  app.useGlobalFilters(new HttpExceptionFilter());

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Route to Office API')
    .setDescription('Backend for the Route to Office web app (Phase 1).')
    .setVersion('0.1.0')
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document);

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  new Logger('Bootstrap').log(`Listening on http://0.0.0.0:${port} (docs at /docs)`);
}

bootstrap().catch((err) => {
  new Logger('Bootstrap').error(
    `Failed to bootstrap: ${(err as Error).message}`,
    (err as Error).stack,
  );
  process.exit(1);
});
