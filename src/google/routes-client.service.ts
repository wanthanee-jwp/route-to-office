import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AxiosError } from 'axios';
import { firstValueFrom, timeout, TimeoutError } from 'rxjs';
import {
  RouteNotFoundException,
  UpstreamApiException,
  UpstreamTimeoutException,
} from '../common/exceptions/route.exceptions';

// The only place in the codebase that talks to Google Routes API.
// Sends the three parameters that together enable traffic-aware routing
// (requirement.md §4) and requests a minimal field mask so we pay only for
// the numbers we display.

const ROUTES_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes';
const FIELD_MASK =
  'routes.duration,routes.staticDuration,routes.distanceMeters,routes.polyline.encodedPolyline';
const TIMEOUT_MS = 8_000;

export interface LatLng {
  lat: number;
  lng: number;
}

export interface Destination {
  lat: number;
  lng: number;
  placeId?: string;
}

export interface ComputedRoute {
  distanceMeters: number;
  durationSeconds: number;
  staticDurationSeconds: number;
  encodedPolyline: string;
}

interface RoutesApiResponse {
  routes?: Array<{
    duration?: string;
    staticDuration?: string;
    distanceMeters?: number;
    polyline?: { encodedPolyline?: string };
  }>;
}

@Injectable()
export class RoutesClientService {
  private readonly logger = new Logger(RoutesClientService.name);
  private readonly apiKey: string;

  constructor(config: ConfigService, private readonly http: HttpService) {
    this.apiKey = config.getOrThrow<string>('GOOGLE_MAPS_SERVER_KEY');
  }

  async computeRoute(origin: LatLng, destination: Destination): Promise<ComputedRoute> {
    const body = {
      origin: { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } },
      // Prefer placeId when we have one — Google knows the building entrance,
      // so the route ends at the right side of the block (§10).
      destination: destination.placeId
        ? { placeId: destination.placeId }
        : {
            location: {
              latLng: { latitude: destination.lat, longitude: destination.lng },
            },
          },
      travelMode: 'DRIVE',
      routingPreference: 'TRAFFIC_AWARE_OPTIMAL',
      departureTime: new Date().toISOString(),
    };

    let data: RoutesApiResponse;
    try {
      const res = await firstValueFrom(
        this.http
          .post<RoutesApiResponse>(ROUTES_URL, body, {
            headers: {
              'Content-Type': 'application/json',
              'X-Goog-Api-Key': this.apiKey,
              'X-Goog-FieldMask': FIELD_MASK,
            },
            timeout: TIMEOUT_MS,
          })
          .pipe(timeout(TIMEOUT_MS)),
      );
      data = res.data;
    } catch (err) {
      throw this.translate(err);
    }

    const route = data.routes?.[0];
    if (!route) {
      throw new RouteNotFoundException();
    }

    const durationSeconds = parseDuration(route.duration);
    const staticDurationSeconds = parseDuration(route.staticDuration);
    if (
      route.distanceMeters === undefined ||
      durationSeconds === null ||
      staticDurationSeconds === null ||
      !route.polyline?.encodedPolyline
    ) {
      this.logger.error({ route }, 'Routes API response missing required fields');
      throw new UpstreamApiException();
    }

    return {
      distanceMeters: route.distanceMeters,
      durationSeconds,
      staticDurationSeconds,
      encodedPolyline: route.polyline.encodedPolyline,
    };
  }

  private translate(err: unknown): Error {
    if (err instanceof TimeoutError) {
      this.logger.warn('Routes API request timed out');
      return new UpstreamTimeoutException();
    }
    if (err instanceof AxiosError) {
      // Log the full upstream error server-side; user only sees the generic message.
      this.logger.error(
        {
          status: err.response?.status,
          data: err.response?.data,
          code: err.code,
        },
        'Routes API request failed',
      );
      if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') {
        return new UpstreamTimeoutException();
      }
      return new UpstreamApiException();
    }
    this.logger.error({ err }, 'Unexpected error calling Routes API');
    return new UpstreamApiException();
  }
}

// Routes API returns durations like "1234s" (protobuf Duration string form).
function parseDuration(value: string | undefined): number | null {
  if (!value) return null;
  const match = /^(-?\d+(?:\.\d+)?)s$/.exec(value);
  if (!match) return null;
  return Math.round(parseFloat(match[1]));
}
