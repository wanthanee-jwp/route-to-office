import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { HealthCheck, HealthCheckService } from '@nestjs/terminus';

// Kept lightweight on purpose: App Runner polls this frequently and we don't
// want the health check itself to call Google (which would spend quota).
@ApiTags('health')
@Controller('healthz')
export class HealthController {
  constructor(private readonly health: HealthCheckService) {}

  @Get()
  @HealthCheck()
  check() {
    return this.health.check([]);
  }
}
