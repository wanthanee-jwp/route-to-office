import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { HealthCheck, HealthCheckService } from '@nestjs/terminus';

// Kept lightweight on purpose: platform health probes hit this frequently and
// we don't want the health check itself to call Google (which would spend
// quota). Path is /health (not /healthz) — Cloud Run reserves /healthz at the
// edge and returns 404 before the request reaches the container.
@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthCheckService) {}

  @Get()
  @HealthCheck()
  check() {
    return this.health.check([]);
  }
}
