import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { OriginGuard } from '../common/guards/origin.guard';
import { CompanyService, Company } from './company.service';

interface ConfigResponse {
  googleMapsBrowserKey: string;
}

@ApiTags('company')
@Controller('api')
export class CompanyController {
  constructor(private readonly companyService: CompanyService) {}

  @Get('company')
  @ApiOkResponse({ description: 'Office name, address, coordinates and place ID.' })
  getCompany(): Company {
    return this.companyService.getCompany();
  }

  // The browser key is not a secret in the strict sense (the client must see it
  // to load Maps JS), but we still restrict /api/config to our own frontend
  // Origin so casual scraping doesn't harvest it. Referrer restrictions on the
  // key itself are the real protection.
  @Get('config')
  @UseGuards(OriginGuard)
  @ApiOkResponse({ description: 'Browser-facing Google Maps JavaScript API key.' })
  getConfig(): ConfigResponse {
    return { googleMapsBrowserKey: this.companyService.getBrowserKey() };
  }
}
