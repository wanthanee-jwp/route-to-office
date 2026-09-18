import { Global, Logger, Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { loadSecrets } from './secrets.loader';

// Use @nestjs/config's forRootAsync with a factory that runs the secrets
// loader before the app boots. If validation fails we log the message and
// exit with code 1 rather than start in a broken state (requirement.md §5).

const bootstrapLogger = new Logger('ConfigBootstrap');

@Global()
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      // The load() factory is awaited before ConfigService is constructed,
      // so downstream providers see the resolved values.
      load: [
        async () => {
          try {
            await loadSecrets();
          } catch (err) {
            bootstrapLogger.error(
              `Configuration failed: ${(err as Error).message}`,
            );
            // Fail fast — a broken config at boot is safer than a broken request at run time.
            process.exit(1);
          }
          return {};
        },
      ],
    }),
  ],
})
export class ConfigModule {}
