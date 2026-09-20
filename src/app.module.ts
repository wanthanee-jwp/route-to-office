import { CacheModule } from '@nestjs/cache-manager';
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ServeStaticModule } from '@nestjs/serve-static';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { join } from 'node:path';
import { CompanyModule } from './company/company.module';
import { ConfigModule } from './config/config.module';
import { HealthModule } from './health/health.module';
import { RouteModule } from './route/route.module';

@Module({
  imports: [
    // ConfigModule must be listed first so secrets are loaded before any
    // other provider (CompanyService, RoutesClientService) is constructed.
    ConfigModule,

    // Rate limiting per requirement.md §8: 20 req/min per IP, 500 req/min
    // system-wide. Real client IPs come from X-Forwarded-For once `trust proxy`
    // is on in main.ts — otherwise every user looks like the App Runner proxy.
    ThrottlerModule.forRoot([
      { name: 'per-ip', ttl: 60_000, limit: 20 },
      { name: 'system', ttl: 60_000, limit: 500 },
    ]),

    // In-memory cache (single App Runner instance by design). If we ever need
    // to scale out, swap the store to Redis here — nothing else changes.
    CacheModule.register({ isGlobal: true, ttl: 5 * 60 * 1000 }),

    RouteModule,
    CompanyModule,
    HealthModule,

    // Serve the built frontend (web/dist) at /. Excludes exist so /api/* and
    // /docs still resolve through Nest controllers instead of returning
    // index.html. rootPath is resolved from process.cwd() so it works in both
    // dev (`npm run start:dev`) and prod (`node dist/main` from /app).
    ServeStaticModule.forRoot({
      rootPath: join(process.cwd(), 'web', 'dist'),
      exclude: ['/api/{*path}', '/docs', '/docs/{*path}', '/healthz'],
      serveStaticOptions: {
        // index.html for the SPA entry; other paths fall through to the
        // controllers or 404. No client-side routing to worry about.
        index: 'index.html',
        fallthrough: true,
      },
    }),
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
