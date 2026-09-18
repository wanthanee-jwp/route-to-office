import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

// Origin check for /api/config so the browser key can only be harvested by our
// own frontend, not by any page that knows the URL (requirement.md §9).
// This complements CORS — CORS blocks *browser* requests from other origins,
// but a scraper can still call the endpoint directly. Requiring a matching
// Origin header is a cheap extra hurdle.

@Injectable()
export class OriginGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const origin = req.headers.origin ?? (req.headers.referer as string | undefined);
    const allowed = this.parseAllowed();

    if (allowed.length === 0) {
      // No allowlist configured — refuse by default rather than fail-open.
      throw new ForbiddenException({ message: 'Origin not permitted.' });
    }

    if (!origin || !allowed.some((prefix) => origin.startsWith(prefix))) {
      throw new ForbiddenException({ message: 'Origin not permitted.' });
    }
    return true;
  }

  private parseAllowed(): string[] {
    const raw = this.config.get<string>('FRONTEND_ORIGINS', '');
    return raw
      .split(',')
      .map((s) => s.trim().replace(/\/$/, ''))
      .filter((s) => s.length > 0);
  }
}
