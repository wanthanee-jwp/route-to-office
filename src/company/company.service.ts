import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// Single source of truth for office coordinates (requirement.md §6).
// Any code that needs the office location injects this service. When Phase 2
// introduces multiple branches or an admin screen, the internals of this class
// change to read from a database — nothing else has to move because everyone
// already depends on this one provider.

export interface Company {
  name: string;
  address: string;
  lat: number;
  lng: number;
  placeId?: string;
}

@Injectable()
export class CompanyService {
  private readonly company: Company;
  private readonly browserKey: string;

  constructor(config: ConfigService) {
    const placeId = config.get<string>('COMPANY_PLACE_ID');
    this.company = {
      name: config.getOrThrow<string>('COMPANY_NAME'),
      address: config.getOrThrow<string>('COMPANY_ADDRESS'),
      lat: Number(config.getOrThrow<string>('COMPANY_LAT')),
      lng: Number(config.getOrThrow<string>('COMPANY_LNG')),
      ...(placeId ? { placeId } : {}),
    };
    this.browserKey = config.getOrThrow<string>('GOOGLE_MAPS_BROWSER_KEY');
  }

  getCompany(): Company {
    return this.company;
  }

  getBrowserKey(): string {
    return this.browserKey;
  }
}
