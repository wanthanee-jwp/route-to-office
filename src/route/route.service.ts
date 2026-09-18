import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Cache } from 'cache-manager';
import { CompanyService } from '../company/company.service';
import { LocationTooFarException } from '../common/exceptions/route.exceptions';
import {
  formatDistance,
  formatDuration,
} from '../common/formatters/units.formatter';
import { RoutesClientService } from '../google/routes-client.service';
import { RouteResponseDto } from './dto/route-response.dto';

// Max great-circle distance from the office. Anything farther is almost
// certainly a bug or a probe and burning Routes API quota on it is wasteful
// (requirement.md §6).
const MAX_DISTANCE_KM = 500;

// Cache TTL and key strategy from requirement.md §8. Rounding coordinates to
// 3dp (~110 m) plus a 5-minute time bucket lets users in the same building
// during the same window share one Routes API call.
const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_BUCKET_SECONDS = 300;

@Injectable()
export class RouteService {
  private readonly logger = new Logger(RouteService.name);

  constructor(
    private readonly companyService: CompanyService,
    private readonly routesClient: RoutesClientService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {}

  async computeRoute(userLat: number, userLng: number): Promise<RouteResponseDto> {
    const company = this.companyService.getCompany();

    const greatCircleKm = haversineKm(userLat, userLng, company.lat, company.lng);
    if (greatCircleKm > MAX_DISTANCE_KM) {
      throw new LocationTooFarException();
    }

    const key = cacheKey(userLat, userLng);
    const cached = await this.cache.get<RouteResponseDto>(key);
    if (cached) {
      return { ...cached, cached: true };
    }

    // PDPA: log at reduced precision only (§8).
    this.logger.log(
      { lat: userLat.toFixed(2), lng: userLng.toFixed(2) },
      'Computing new route',
    );

    const route = await this.routesClient.computeRoute(
      { lat: userLat, lng: userLng },
      { lat: company.lat, lng: company.lng, placeId: company.placeId },
    );

    const response: RouteResponseDto = {
      distance: formatDistance(route.distanceMeters),
      duration: formatDuration(route.durationSeconds),
      staticDuration: formatDuration(route.staticDurationSeconds),
      trafficDelaySeconds: Math.max(
        0,
        route.durationSeconds - route.staticDurationSeconds,
      ),
      polyline: route.encodedPolyline,
      origin: { lat: userLat, lng: userLng },
      destination: { lat: company.lat, lng: company.lng },
      computedAt: new Date().toISOString(),
      cached: false,
    };

    await this.cache.set(key, response, CACHE_TTL_MS);
    return response;
  }
}

function cacheKey(lat: number, lng: number): string {
  const bucket = Math.floor(Date.now() / 1000 / CACHE_BUCKET_SECONDS);
  return `route:${lat.toFixed(3)}:${lng.toFixed(3)}:${bucket}`;
}

// Great-circle distance in kilometres. Good enough to reject "wrong continent"
// coordinates cheaply before we spend a Routes API call to find out.
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
